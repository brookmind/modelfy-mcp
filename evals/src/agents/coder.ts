import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { Readable, Writable } from "node:stream";
import { z } from "zod";
import { savedKey } from "../env-file.ts";
import { TraceEventSchema, type Trace, type TraceEvent } from "../trace.ts";

/** Modelfy device codes: XXXX-XXXX from consonants only (no vowels). */
const USER_CODE = /\b[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}\b/;
const RUN_TIMEOUT_MS = 15 * 60 * 1000;
/** slirp4netns is ready in well under a second when it works at all. */
const NETWORK_READY_TIMEOUT_MS = 30 * 1000;
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

/** From /etc, only what TLS and user lookups need (DNS: sandbox/resolv.conf). */
const ETC_FILES = [
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
 * folders read-only, an empty home, only the run folder writable. The host's
 * home (tokens, configs) and the rest of /etc are never mounted. It gets its
 * own network namespace, which slirp4netns connects to the internet without
 * the host's loopback (see spawnSandboxed): fd 3 reports the namespace's pid
 * and the command waits on fd 4 until the network is up.
 */
export function bwrapArgs(paths: SandboxPaths): string[] {
  return [
    "--ro-bind",
    "/usr",
    "/usr",
    ...ETC_FILES.flatMap((path) => ["--ro-bind-try", path, path]),
    "--ro-bind",
    `${paths.harness}/sandbox/resolv.conf`,
    "/etc/resolv.conf",
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
    "--die-with-parent",
    "--info-fd",
    "3",
    "--block-fd",
    "4",
    "--chdir",
    "/work",
  ];
}

const BwrapInfo = z.object({ "child-pid": z.number().int().positive() });

export interface SandboxProcess {
  /** stdin, stdout and stderr are pipes */
  child: ChildProcess;
  /**
   * Why the sandbox's network failed, if it did: then the run measured the
   * harness, not the agent, and must not be graded.
   */
  networkError(): string | null;
  /**
   * Kills the whole sandbox and closes its pipes, so whatever waits on it
   * ends. Killing bwrap alone is not enough: the process inside the
   * namespace can outlive it and keep the pipes open.
   */
  stop(): void;
}

/**
 * Starts a command in the sandbox and connects its network: once bwrap
 * reports the namespace's pid, slirp4netns gives it internet access (with
 * the host's loopback disabled), then the command is released. If the
 * network fails or is not ready in time, the sandbox is stopped and
 * networkError() says why.
 */
export function spawnSandboxed(
  paths: SandboxPaths,
  command: string[],
  env: NodeJS.ProcessEnv,
): SandboxProcess {
  const child = spawn("bwrap", [...bwrapArgs(paths), ...command], {
    stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"],
    env,
  });
  const info = child.stdio[3];
  const release = child.stdio[4];
  if (!(info instanceof Readable) || !(release instanceof Writable)) {
    child.kill("SIGKILL");
    throw new Error("bwrap's info and block pipes are missing");
  }
  let failure: string | null = null;
  let finished = false;
  let released = false;
  let namespacePid: number | null = null;
  const stop = (): void => {
    child.kill("SIGKILL");
    if (namespacePid !== null) {
      try {
        process.kill(namespacePid, "SIGKILL");
      } catch {
        // Already gone
      }
    }
    for (const stream of child.stdio) stream?.destroy();
  };
  const fail = (reason: string): void => {
    failure ??= reason;
    stop();
  };
  const readyTimer = setTimeout(() => {
    if (!released) {
      fail(
        `the sandbox network was not ready after ${String(NETWORK_READY_TIMEOUT_MS / 1000)}s`,
      );
    }
  }, NETWORK_READY_TIMEOUT_MS);
  let text = "";
  let network: ChildProcess | null = null;
  info.on("data", (chunk: Buffer) => {
    text += chunk.toString();
    if (network !== null) return;
    let pid: number;
    try {
      pid = BwrapInfo.parse(JSON.parse(text))["child-pid"];
    } catch {
      return; // Not the whole JSON yet
    }
    namespacePid = pid;
    network = spawn(
      "slirp4netns",
      [
        "--configure",
        "--mtu=65520",
        "--disable-host-loopback",
        "--ready-fd",
        "3",
        String(pid),
        "tap0",
      ],
      { stdio: ["ignore", "ignore", "pipe", "pipe"] },
    );
    let log = "";
    network.stderr?.on("data", (data: Buffer) => {
      log = (log + data.toString()).slice(-500);
    });
    const ready = network.stdio[3];
    if (!(ready instanceof Readable)) {
      fail("slirp4netns has no ready pipe");
      return;
    }
    ready.once("data", () => {
      released = true;
      clearTimeout(readyTimer);
      release.end("1");
    });
    network.on("error", (error) => {
      fail(`slirp4netns could not start: ${error.message}`);
    });
    network.on("exit", (code, signal) => {
      // The network went away while the command still needed it
      if (!finished) {
        fail(`slirp4netns stopped (${String(code ?? signal)}): ${log.trim()}`);
      }
    });
  });
  child.on("exit", () => {
    finished = true;
    clearTimeout(readyTimer);
    network?.kill();
  });
  return {
    child,
    // A command that never got its network measured nothing
    networkError: () =>
      failure ??
      (finished && !released ? "the sandbox network never started" : null),
    stop,
  };
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
  const sandbox = spawnSandboxed(
    paths,
    [
      "/usr/bin/node",
      "/harness/node_modules/tsx/dist/cli.mjs",
      "/harness/src/agents/coder-child.ts",
      prompt,
    ],
    sandboxEnv(anthropicKey),
  );
  const { child } = sandbox;
  const { stdin, stdout, stderr: errors } = child;
  if (stdin === null || stdout === null || errors === null) {
    child.kill("SIGKILL");
    throw new Error("The sandboxed agent has no stdio pipes");
  }
  const timer = setTimeout(() => {
    trace.stopReason = "timeout";
    sandbox.stop();
  }, RUN_TIMEOUT_MS);
  let stderr = "";
  errors.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4000);
  });

  let approvedCode: string | null = null;
  const tried = new Set<string>();
  // An approval the agent has not been told about yet
  let untold = false;
  for await (const line of createInterface({ input: stdout })) {
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
      stdin.write(tell ? `continue ${APPROVED_MESSAGE}\n` : "stop\n");
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
  const networkError = sandbox.networkError();
  // The harness failed, not the agent: no grade; the runner retries it later
  if (networkError !== null) throw new Error(networkError);
  if (trace.stopReason === "" && stderr !== "")
    trace.stopReason = `crashed: ${stderr.slice(-300)}`;
  trace.endedAt = Date.now();
  return { trace, approvedCode };
}
