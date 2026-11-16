import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  bwrapArgs,
  codeToApprove,
  findUserCode,
  shouldTellApproved,
} from "../src/agents/coder.ts";
import type { TraceEvent } from "../src/trace.ts";
import { redact } from "../src/results.ts";
import { deviceLoginReasons, nodeScriptReasons } from "../src/tasks/suite-b.ts";
import { Script } from "./script.ts";

const KEY = `mfy_test_${"Q".repeat(43)}`;

describe("findUserCode", () => {
  it("finds an RFC 8628 user code in text", () => {
    expect(findUserCode("Open the link and enter WDJB-MJHT to approve.")).toBe(
      "WDJB-MJHT",
    );
  });

  it("ignores the docs' example code", () => {
    expect(
      findUserCode('Example: {"user_code": "BCDF-GHJK", "device_code": "…"}'),
    ).toBeNull();
  });

  it("ignores a code-like string with no device login around it", () => {
    expect(
      findUserCode('{"upload_id":"sbx_x-BCDF-GHJK","status":"ready"}'),
    ).toBeNull();
  });

  it("ignores codes with vowels (Modelfy codes never have them)", () => {
    expect(findUserCode("Open /activate and enter ABCD-EFGH")).toBeNull();
  });

  it("finds the code inside a JSON tool result", () => {
    expect(findUserCode('{"user_code":"PQRS-TVWX","interval":5}')).toBe(
      "PQRS-TVWX",
    );
  });
});

describe("which device code the person approves", () => {
  const shown = (text: string): TraceEvent => ({
    kind: "agent_text",
    text,
    at: 0,
  });

  it("approves a code the agent shows the person", () => {
    expect(
      codeToApprove(shown("Open /activate and enter PQRS-TVWX"), new Set()),
    ).toBe("PQRS-TVWX");
  });

  it("does not approve a code that only appears in a command's output", () => {
    const output: TraceEvent = {
      kind: "tool_result",
      id: "t1",
      tool: "Bash",
      isError: false,
      code: null,
      text: '{"user_code":"PQRS-TVWX","verification_uri":"…/activate"}',
      at: 0,
    };

    expect(codeToApprove(output, new Set())).toBeNull();
  });

  it("approves a later, new code but never the same one twice", () => {
    const tried = new Set(["PQRS-TVWX"]);

    expect(
      codeToApprove(shown("Approve PQRS-TVWX at /activate"), tried),
    ).toBeNull();
    expect(
      codeToApprove(shown("New code: KLMN-BCDF at /activate"), tried),
    ).toBe("KLMN-BCDF");
  });
});

describe("telling the agent the code was approved", () => {
  it("tells it once, while it still waits for the key", () => {
    expect(
      shouldTellApproved({
        approved: true,
        alreadyTold: false,
        keySaved: false,
      }),
    ).toBe(true);
  });

  it("stays quiet when the agent already saved the key", () => {
    expect(
      shouldTellApproved({
        approved: true,
        alreadyTold: false,
        keySaved: true,
      }),
    ).toBe(false);
  });

  it("stays quiet when nothing was approved or it was already told", () => {
    expect(
      shouldTellApproved({
        approved: false,
        alreadyTold: false,
        keySaved: false,
      }),
    ).toBe(false);
    expect(
      shouldTellApproved({
        approved: true,
        alreadyTold: true,
        keySaved: false,
      }),
    ).toBe(false);
  });
});

describe("node-script check", () => {
  it("passes when the rerun works and made 4 new photos", () => {
    expect(
      nodeScriptReasons({
        rerunFailure: null,
        photosBefore: 8,
        photosAfter: 12,
      }),
    ).toEqual([]);
  });

  it("fails when the rerun exits 0 but made no new photos", () => {
    expect(
      nodeScriptReasons({
        rerunFailure: null,
        photosBefore: 8,
        photosAfter: 8,
      }),
    ).toContain("the rerun made 0 new photos, not 4");
  });

  it("fails when the rerun fails", () => {
    expect(
      nodeScriptReasons({
        rerunFailure: "exit 1",
        photosBefore: 4,
        photosAfter: 4,
      }),
    ).toContain("make-photos.mjs failed when rerun: exit 1");
  });
});

describe("device-login check", () => {
  it("fails when the key appears in the agent's own messages", () => {
    const trace = new Script()
      .agent("Open https://beta-dev.modelfy.ai/activate?code=BCDF-GHJK")
      .agent(`Done! Your key is ${KEY}`)
      .trace();

    expect(
      deviceLoginReasons(trace, {
        approved: true,
        savedKey: KEY,
        keyWorks: true,
      }),
    ).toContain("printed the key in its messages");
  });

  it("passes when the key was approved, saved, works and stayed hidden", () => {
    const trace = new Script()
      .agent("Open https://beta-dev.modelfy.ai/activate?code=BCDF-GHJK")
      .agent("Done: the key is saved in .env as MODELFY_API_KEY.")
      .trace();

    expect(
      deviceLoginReasons(trace, {
        approved: true,
        savedKey: KEY,
        keyWorks: true,
      }),
    ).toEqual([]);
  });

  it("fails when the person never saw the code", () => {
    const trace = new Script().agent("I am polling for approval…").trace();

    expect(
      deviceLoginReasons(trace, {
        approved: false,
        savedKey: null,
        keyWorks: false,
      }),
    ).toContain("never showed the person a code to approve");
  });
});

describe("the sandbox around the coding agent", () => {
  it("never binds the host home, only the harness and the run folder", () => {
    const harness = "/srv/evals";
    const runDir = "/srv/evals/runs/abc";
    const args = bwrapArgs({ harness, runDir });
    const home = homedir();

    const bound = args.flatMap((arg, index) =>
      ["--bind", "--ro-bind"].includes(args[index - 1] ?? "") ? [arg] : [],
    );

    expect(
      bound.filter((path) => path === home || path.startsWith(`${home}/`)),
    ).toEqual([]);
    expect(args.join(" ")).not.toContain("--ro-bind /etc /etc");
    expect(args.join(" ")).toContain("/etc/resolv.conf");
    expect(args).toContain("--unshare-all");
    expect(args).toContain("--share-net");
    expect(args.join(" ")).toContain(`--bind ${runDir} /work`);
  });

  it("mounts only the code the agent runs, never secrets, runs or results", () => {
    const args = bwrapArgs({
      harness: "/srv/evals",
      runDir: "/srv/evals/runs/abc",
    });
    const bound = args.flatMap((arg, index) =>
      ["--bind", "--ro-bind"].includes(args[index - 1] ?? "") ? [arg] : [],
    );

    expect(bound).not.toContain("/srv/evals");
    expect(bound).toEqual(
      expect.arrayContaining([
        "/srv/evals/src",
        "/srv/evals/node_modules",
        "/srv/evals/package.json",
      ]),
    );
    expect(
      bound.filter((path) =>
        ["/.secrets", "/results", "/runs/"].some(
          (part) => path.includes(part) && path !== "/srv/evals/runs/abc",
        ),
      ),
    ).toEqual([]);
  });
});

describe("redaction of Anthropic keys", () => {
  it("removes an Anthropic API key from any text", () => {
    expect(
      redact(`env: ANTHROPIC_API_KEY=sk-ant-api03-${"x".repeat(40)}`),
    ).toBe("env: ANTHROPIC_API_KEY=sk-ant-***");
  });
});
