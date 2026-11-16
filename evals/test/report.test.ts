import { describe, expect, it } from "vitest";
import { renderReport, summarize, wilson } from "../src/report.ts";
import { metricsOf, type ResultRow } from "../src/results.ts";
import { Script } from "./script.ts";

function row(
  task: string,
  arm: "v0" | "bare",
  rep: number,
  success: boolean,
  reasons: string[] = [],
): ResultRow {
  const trace = new Script().person("hi").call("get_account", {}, "{}").trace();
  return {
    runId: "r1",
    task,
    suite: "a",
    arm,
    rep,
    models: ["claude-haiku-5-5"],
    grade: { success, reasons, judged: {} },
    metrics: metricsOf(trace, [], { personInChat: true }),
    trace,
  };
}

describe("wilson", () => {
  it("gives [0.40, 0.89] for 7 of 10", () => {
    const [low, high] = wilson(7, 10);

    expect(low).toBeCloseTo(0.4, 2);
    expect(high).toBeCloseTo(0.89, 2);
  });

  it("gives [0, 0] for no runs", () => {
    expect(wilson(0, 0)).toEqual([0, 0]);
  });
});

describe("summarize", () => {
  it("counts success per arm and groups failure reasons", () => {
    const summary = summarize([
      row("says-no", "v0", 0, true),
      row("says-no", "v0", 1, false, [
        "called generate_photos after the person said no",
      ]),
      row("says-no", "bare", 0, false, [
        "called generate_photos after the person said no",
      ]),
      row("budget", "bare", 0, false, [
        "called generate_photos after the person said no",
      ]),
    ]);

    expect(summary.arms.map((arm) => [arm.arm, arm.runs, arm.passes])).toEqual([
      ["bare", 2, 0],
      ["v0", 2, 1],
    ]);
    expect(summary.reasons).toContainEqual({
      arm: "bare",
      reason: "called generate_photos after the person said no",
      count: 2,
    });
  });
});

describe("renderReport", () => {
  it("puts the arms as columns in the order bare, v0", () => {
    const markdown = renderReport(
      [row("says-no", "v0", 0, true), row("says-no", "bare", 0, false)],
      ["r1"],
    );
    const header = markdown
      .split("\n")
      .find((line) => line.startsWith("| Metric"));

    expect(header).toBe("| Metric | bare | v0 |");
  });

  it("divides cost and time by the runs that passed, not by all runs", () => {
    const paid = (success: boolean, rep: number): ResultRow => {
      const base = row("says-no", "v0", rep, success);
      return {
        ...base,
        metrics: { ...base.metrics, costUsd: 0.01, seconds: 20 },
      };
    };
    const markdown = renderReport(
      [paid(true, 0), paid(false, 1), paid(false, 2), paid(false, 3)],
      ["r1"],
    );

    // 4 runs at $0.01 and 20 s each, 1 passed
    expect(markdown).toContain("| Cost per run (USD) | $0.0100 |");
    expect(markdown).toContain("| Cost per successful run (USD) | $0.0400 |");
    expect(markdown).toContain("| Seconds per successful run | 80 |");
  });

  it("shows no per-success figure when nothing passed", () => {
    const markdown = renderReport([row("says-no", "v0", 0, false)], ["r1"]);

    expect(markdown).toContain("| Cost per successful run (USD) | – |");
    expect(markdown).toContain("| Seconds per successful run | – |");
  });

  it("compares the arms on the chat suite only and shows the coding agent apart", () => {
    const coding: ResultRow = {
      ...row("node-script", "v0", 0, true),
      suite: "b",
    };
    const markdown = renderReport(
      [
        row("says-no", "v0", 0, false),
        row("says-no", "bare", 0, false),
        coding,
      ],
      ["r1"],
    );
    const chat = markdown.slice(
      markdown.indexOf("## Chat assistant"),
      markdown.indexOf("## Coding agent"),
    );

    expect(chat).toContain(
      "| Task success (95% interval) | 0% (0%–79%) | 0% (0%–79%) |",
    );
    expect(markdown).toContain("## Coding agent");
    expect(markdown.slice(markdown.indexOf("## Coding agent"))).toContain(
      "| Task success (95% interval) | 100%",
    );
  });

  it("states the noise level and the models", () => {
    const markdown = renderReport([row("says-no", "v0", 0, true)], ["r1"]);

    expect(markdown).toContain("95%");
    expect(markdown).toContain("claude-haiku-5-5");
  });

  it("names the server version each run measured", () => {
    const markdown = renderReport([row("says-no", "v0", 0, true)], ["r1"], {
      r1: "Worker 91de9ef4 (main 224c846)",
    });

    expect(markdown).toContain("`r1`: Worker 91de9ef4 (main 224c846)");
  });
});
