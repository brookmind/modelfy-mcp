import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { z } from "zod";
import { savedKey } from "../env-file.ts";
import { TraceEventSchema, type Trace, type TraceEvent } from "../trace.ts";

/** Modelfy device codes: XXXX-XXXX from consonants only (no vowels). */
const USER_CODE = /\b[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}\b/;
const RUN_TIMEOUT_MS = 15 * 60 * 1000;
const APPROVED_MESSAGE =
  "I opened the link and approved it in the browser. Please go on.";

/** Only text about a device login can carry a code to approve. */
const DEVICE_CONTEXT = /activate|approve|user_code|user code|device/i;

/** The sample code in docs/keys.md: an agent that read the docs prints it. */
const DOCS_EXAMPLE_CODES = new Set(["BCDF-GHJK"]);

export function findUserCode(text: string): string | null {
  if (!DEVICE_CONTEXT.test(text)) return null;
  const pattern = new RegExp(USER_CODE.source, "g");
  for (const match of text.matchAll(pattern)) {
    if (!DOCS_EXAMPLE_CODES.has(match[0])) return match[0];
  }
  return null;
}

/**
 * The code the person approves now: one the agent showed them in its own
 * words (a code only in a command's output was never shown), not tried yet.
 */
export function codeToApprove(
  event: TraceEvent,
  tried: ReadonlySet<string>,
): string | null {
  if (event.kind !== "agent_text") return null;
  const code = findUserCode(event.text);
  return code !== null && !tried.has(code) ? code : null;
}

/**
 * The person says "I approved it" once, and only while the agent still waits
 * for the key: an agent that already saved it would take the message as a
 * new request.
 */
export function shouldTellApproved(state: {
  approved: boolean;
  alreadyTold: boolean;
  keySaved: boolean;
}): boolean {
  return state.approved && !state.alreadyTold && !state.keySaved;
}

export interface SandboxPaths {
  /** The evals package (read-only inside, at /harness) */
  harness: string;
  /** This run's folder (read-write inside, at /work) */
  runDir: string;
}

/** The parts of the evals package the agent's process needs to run. */
const HARNESS_PARTS = ["src", "node_modules", "package.json", "tsconfig.json"];

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
    // Only what the agent's process runs: never .secrets (the dev session),
    // runs (other runs' keys and answers) or results (graded traces)
    ...HARNESS_PARTS.flatMap((part) => [
      "--ro-bind",
      `${paths.harness}/${part}`,
      `/harness/${part}`,
    ]),
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
  TraceEventSchema,
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
  // An approval the agent has not been told about yet
  let untold = false;
  for await (const line of createInterface({ input: child.stdout })) {
    let parsed: z.infer<typeof EventSchema>;
    try {
      parsed = EventSchema.parse(JSON.parse(line));
    } catch {
      continue; // Not a trace line (a library printed something)
    }
    if (parsed.kind === "turn_end") {
      trace.stopReason = parsed.stopReason;
      const tell = shouldTellApproved({
        approved: untold,
        alreadyTold: false,
        keySaved: (await savedKey(paths.runDir)) !== null,
      });
      untold = false;
      child.stdin.write(tell ? `continue ${APPROVED_MESSAGE}\n` : "stop\n");
      continue;
    }
    const event: TraceEvent = parsed;
    trace.events.push(event);
    const code = codeToApprove(event, tried);
    if (code === null) continue;
    tried.add(code);
    try {
      await approve(code);
      approvedCode = code;
      untold = true;
    } catch (error) {
      // The person could not approve (wrong code, no dev session): the run
      // goes on, and its grade shows what was approved
      console.log(
        `could not approve ${code}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  clearTimeout(timer);
  if (trace.stopReason === "" && stderr !== "")
    trace.stopReason = `crashed: ${stderr.slice(-300)}`;
  trace.endedAt = Date.now();
  return { trace, approvedCode };
}
