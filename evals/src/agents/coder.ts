import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { z } from "zod";
import type { Trace, TraceEvent } from "../trace.ts";

/** Modelfy device codes: XXXX-XXXX from consonants only (no vowels). */
const USER_CODE = /\b[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}\b/;
const RUN_TIMEOUT_MS = 15 * 60 * 1000;
const APPROVED_MESSAGE =
  "I opened the link and approved it in the browser. Please go on.";

/** Only text about a device login can carry a code to approve. */
const DEVICE_CONTEXT = /activate|approve|user_code|user code|device/i;

export function findUserCode(text: string): string | null {
  if (!DEVICE_CONTEXT.test(text)) return null;
  return USER_CODE.exec(text)?.[0] ?? null;
}

export interface SandboxPaths {
  /** The evals package (read-only inside, at /harness) */
  harness: string;
  /** This run's folder (read-write inside, at /work) */
  runDir: string;
}

/** From /etc, only what DNS, TLS and user lookups need. */
const ETC_FILES = [
  "/etc/resolv.conf",
  "/etc/hosts",
  "/etc/nsswitch.conf",
  "/etc/passwd",
  "/etc/group",
  "/etc/ssl",
  "/etc/ca-certificates",
  "/etc/alternatives",
];

/**
 * The coding agent runs shell commands, so it runs in bubblewrap: system
 * folders read-only, an empty home, only the run folder writable, network on.
 * The host's home (tokens, configs) and the rest of /etc are never mounted.
 */
export function bwrapArgs(paths: SandboxPaths): string[] {
  return [
    "--ro-bind",
    "/usr",
    "/usr",
    ...ETC_FILES.flatMap((path) => ["--ro-bind-try", path, path]),
    "--symlink",
    "usr/lib",
    "/lib",
    "--symlink",
    "usr/lib64",
    "/lib64",
    "--symlink",
    "usr/bin",
    "/bin",
    "--symlink",
    "usr/sbin",
    "/sbin",
    "--ro-bind",
    paths.harness,
    "/harness",
    "--bind",
    paths.runDir,
    "/work",
    "--tmpfs",
    "/home",
    "--dir",
    "/home/agent",
    "--tmpfs",
    "/tmp",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--unshare-all",
    "--share-net",
    "--die-with-parent",
    "--chdir",
    "/work",
  ];
}

/**
 * The only environment inside the sandbox. The Anthropic key goes here, not
 * in bwrap's arguments, so it never shows in the host's process list.
 */
export function sandboxEnv(anthropicKey: string): NodeJS.ProcessEnv {
  return {
    ANTHROPIC_API_KEY: anthropicKey,
    HOME: "/home/agent",
    PATH: "/usr/local/bin:/usr/bin:/bin",
  };
}

const EventSchema = z.union([
  z.object({ kind: z.literal("turn_end"), stopReason: z.string() }),
  z.object({
    kind: z.enum(["agent_text", "person_text"]),
    text: z.string(),
    at: z.number(),
  }),
  z.object({
    kind: z.literal("tool_call"),
    id: z.string(),
    tool: z.string(),
    input: z.record(z.string(), z.unknown()),
    at: z.number(),
  }),
  z.object({
    kind: z.literal("tool_result"),
    id: z.string(),
    tool: z.string(),
    isError: z.boolean(),
    code: z.string().nullable(),
    text: z.string(),
    at: z.number(),
  }),
  z.object({
    kind: z.literal("usage"),
    role: z.enum(["agent", "person", "judge"]),
    model: z.string(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadTokens: z.number(),
    cacheWriteTokens: z.number(),
  }),
]);

export interface CoderRun {
  trace: Trace;
  /** The device code the "person" approved, if any */
  approvedCode: string | null;
}

/**
 * Runs the coding agent on a prompt in `paths.runDir`. When a device code
 * shows up in what the agent said or in a finished command's output, the
 * person (`approve`) approves it and then tells the agent so.
 */
export async function runCoder(
  prompt: string,
  paths: SandboxPaths,
  anthropicKey: string,
  approve: (userCode: string) => Promise<void>,
): Promise<CoderRun> {
  const startedAt = Date.now();
  const trace: Trace = {
    events: [],
    startedAt,
    endedAt: startedAt,
    stopReason: "",
  };
  trace.events.push({ kind: "person_text", text: prompt, at: 0 });
  const child = spawn(
    "bwrap",
    [
      ...bwrapArgs(paths),
      "/usr/bin/node",
      "/harness/node_modules/tsx/dist/cli.mjs",
      "/harness/src/agents/coder-child.ts",
      prompt,
    ],
    { stdio: ["pipe", "pipe", "pipe"], env: sandboxEnv(anthropicKey) },
  );
  const timer = setTimeout(() => {
    trace.stopReason = "timeout";
    child.kill("SIGKILL");
  }, RUN_TIMEOUT_MS);
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4000);
  });

  let approvedCode: string | null = null;
  const tried = new Set<string>();
  let toldApproved = false;
  for await (const line of createInterface({ input: child.stdout })) {
    let parsed: z.infer<typeof EventSchema>;
    try {
      parsed = EventSchema.parse(JSON.parse(line));
    } catch {
      continue; // Not a trace line (a library printed something)
    }
    if (parsed.kind === "turn_end") {
      trace.stopReason = parsed.stopReason;
      const tell: boolean = approvedCode !== null && !toldApproved;
      toldApproved ||= tell;
      child.stdin.write(tell ? `continue ${APPROVED_MESSAGE}\n` : "stop\n");
      continue;
    }
    const event: TraceEvent = parsed;
    trace.events.push(event);
    if (
      approvedCode === null &&
      (event.kind === "agent_text" || event.kind === "tool_result")
    ) {
      const code = findUserCode(event.text);
      // Each code is tried once, as a person would
      if (code !== null && !tried.has(code)) {
        tried.add(code);
        try {
          await approve(code);
          approvedCode = code;
        } catch (error) {
          // The person could not approve (wrong code, no dev session): the run
          // goes on, and its grade shows that nothing was approved
          approvedCode = null;
          console.log(
            `could not approve ${code}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }
  clearTimeout(timer);
  if (trace.stopReason === "" && stderr !== "")
    trace.stopReason = `crashed: ${stderr.slice(-300)}`;
  trace.endedAt = Date.now();
  return { trace, approvedCode };
}
