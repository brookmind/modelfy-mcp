import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendRow,
  doneKeys,
  metricsOf,
  redact,
  type ResultRow,
} from "../src/results.ts";
import { Script } from "./script.ts";

const KEY = `mfy_test_${"a1B2".repeat(10)}xyz`;
const LIVE = `mfy_live_${"Z9y8".repeat(10)}abc`;

function row(task: string, rep: number): ResultRow {
  const trace = new Script()
    .person(`Use my key ${KEY}`)
    .call("get_account", {}, `{"keyKind":"anonymous"} ${LIVE}`)
    .trace();
  return {
    runId: "test",
    task,
    suite: "a",
    arm: "v0",
    rep,
    models: ["claude-haiku-5-5"],
    grade: { success: true, reasons: [], judged: {} },
    metrics: metricsOf(trace, [], { personInChat: true }),
    trace,
  };
}

async function tempFile(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "evals-")), "results.jsonl");
}

describe("results", () => {
  it("redact removes test and live keys anywhere", () => {
    expect(redact(`a ${KEY} b ${LIVE}`)).toBe("a mfy_test_*** b mfy_live_***");
  });

  it("appendRow writes the row with every key redacted", async () => {
    const path = await tempFile();

    await appendRow(path, row("says-no", 0));
    const written = await readFile(path, "utf8");

    expect(written).not.toContain(KEY);
    expect(written).not.toContain(LIVE);
    expect(written.endsWith("\n")).toBe(true);
  });

  it("appendRow then doneKeys round-trips", async () => {
    const path = await tempFile();

    await appendRow(path, row("says-no", 0));
    await appendRow(path, row("budget", 2));

    expect(await doneKeys(path)).toEqual(
      new Set(["says-no|v0|0", "budget|v0|2"]),
    );
  });

  it("doneKeys ignores a trailing partial line", async () => {
    const path = await tempFile();
    await appendRow(path, row("says-no", 0));
    await writeFile(path, `${await readFile(path, "utf8")}{"runId":"te`);

    expect(await doneKeys(path)).toEqual(new Set(["says-no|v0|0"]));
  });

  it("appendRow after a partial line keeps the new row readable", async () => {
    const path = await tempFile();
    await writeFile(path, '{"runId":"te');

    await appendRow(path, row("budget", 1));

    expect(await doneKeys(path)).toEqual(new Set(["budget|v0|1"]));
  });

  it("doneKeys of a missing file is empty", async () => {
    expect(
      await doneKeys(join(tmpdir(), "no-such-dir", "results.jsonl")),
    ).toEqual(new Set());
  });

  it("metricsOf counts calls, person turns and cost", () => {
    const trace = new Script()
      .person("hi")
      .call("get_account", {}, "{}")
      .call("generate_photos", {}, "x", "BUDGET_EXCEEDED")
      .person("ok")
      .trace();

    const metrics = metricsOf(trace, [], { personInChat: true });

    expect(metrics).toMatchObject({
      toolCalls: 2,
      toolErrors: { BUDGET_EXCEEDED: 1 },
      personTurns: 1,
      inventedIds: [],
      costUsd: 0,
    });
  });

  it("consent is not measured when no launch succeeded", () => {
    const trace = new Script()
      .person("hi")
      .call("generate_photos", { quote_id: "q" }, "x", "BUDGET_EXCEEDED")
      .trace();

    expect(metricsOf(trace, [], { personInChat: true }).consentOk).toBeNull();
  });

  it("consent is not measured for a bot (no person in the chat)", () => {
    const trace = new Script()
      .person("Automated job")
      .call("plan_photos", {}, '{"quote_id":"q_1"}')
      .call("generate_photos", { quote_id: "q_1" }, '{"status":"running"}')
      .trace();

    expect(metricsOf(trace, [], { personInChat: false }).consentOk).toBeNull();
    expect(metricsOf(trace, [], { personInChat: true }).consentOk).toBe(false);
  });
});
