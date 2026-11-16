import type { ResultRow } from "./results.ts";

/** What the report reads from a result row (never the trace). */
export type ReportRow = Pick<
  ResultRow,
  "task" | "suite" | "arm" | "rep" | "models" | "grade" | "metrics"
>;

const ARM_ORDER = ["bare", "v0", "v1"];
const Z = 1.96;

/** The Wilson 95% interval of a pass rate. */
export function wilson(passes: number, runs: number): [number, number] {
  if (runs === 0) return [0, 0];
  const p = passes / runs;
  const denominator = 1 + (Z * Z) / runs;
  const center = (p + (Z * Z) / (2 * runs)) / denominator;
  const margin =
    (Z * Math.sqrt((p * (1 - p)) / runs + (Z * Z) / (4 * runs * runs))) /
    denominator;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

export interface ArmSummary {
  arm: string;
  runs: number;
  passes: number;
  interval: [number, number];
  /** Of the runs that launched something with a person in the chat */
  consentRuns: number;
  consentOk: number;
  inventedIds: number;
  meanToolCalls: number;
  meanErrors: number;
  errors: Record<string, number>;
  meanSeconds: number;
  totalCostUsd: number;
}

export interface TaskSummary {
  task: string;
  suite: "a" | "b";
  arm: string;
  runs: number;
  passes: number;
}

export interface ReasonCount {
  arm: string;
  reason: string;
  count: number;
}

export interface Summary {
  arms: ArmSummary[];
  tasks: TaskSummary[];
  reasons: ReasonCount[];
  models: string[];
}

function armRank(arm: string): number {
  const index = ARM_ORDER.indexOf(arm);
  return index === -1 ? ARM_ORDER.length : index;
}

function mean(values: number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function summarize(rows: ReportRow[]): Summary {
  const arms = [...new Set(rows.map((row) => row.arm))].sort(
    (a, b) => armRank(a) - armRank(b),
  );
  const armSummaries = arms.map((arm): ArmSummary => {
    const own = rows.filter((row) => row.arm === arm);
    const passes = own.filter((row) => row.grade.success).length;
    const consent = own.filter((row) => row.metrics.consentOk !== null);
    const errors: Record<string, number> = {};
    for (const row of own) {
      for (const [code, count] of Object.entries(row.metrics.toolErrors)) {
        errors[code] = (errors[code] ?? 0) + count;
      }
    }
    return {
      arm,
      runs: own.length,
      passes,
      interval: wilson(passes, own.length),
      consentRuns: consent.length,
      consentOk: consent.filter((row) => row.metrics.consentOk === true).length,
      inventedIds: own.reduce(
        (sum, row) => sum + row.metrics.inventedIds.length,
        0,
      ),
      meanToolCalls: mean(own.map((row) => row.metrics.toolCalls)),
      meanErrors: mean(
        own.map((row) =>
          Object.values(row.metrics.toolErrors).reduce(
            (sum, count) => sum + count,
            0,
          ),
        ),
      ),
      errors,
      meanSeconds: mean(own.map((row) => row.metrics.seconds)),
      totalCostUsd: own.reduce((sum, row) => sum + row.metrics.costUsd, 0),
    };
  });

  const taskKeys = [...new Set(rows.map((row) => `${row.task}|${row.arm}`))];
  const tasks = taskKeys.map((key): TaskSummary => {
    const own = rows.filter((row) => `${row.task}|${row.arm}` === key);
    const first = own[0];
    return {
      task: first?.task ?? "",
      suite: first?.suite ?? "a",
      arm: first?.arm ?? "",
      runs: own.length,
      passes: own.filter((row) => row.grade.success).length,
    };
  });

  const reasonCounts = new Map<string, ReasonCount>();
  for (const row of rows) {
    for (const reason of row.grade.reasons) {
      const key = `${row.arm}|${reason}`;
      const found = reasonCounts.get(key);
      if (found === undefined) {
        reasonCounts.set(key, { arm: row.arm, reason, count: 1 });
      } else {
        found.count += 1;
      }
    }
  }

  return {
    arms: armSummaries,
    tasks,
    reasons: [...reasonCounts.values()].sort(
      (a, b) => armRank(a.arm) - armRank(b.arm) || b.count - a.count,
    ),
    models: [...new Set(rows.flatMap((row) => row.models))].sort(),
  };
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function table(header: string[], lines: string[][]): string {
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...lines.map((line) => `| ${line.join(" | ")} |`),
  ].join("\n");
}

/** One suite's headline, per-task table and failure reasons, as Markdown. */
function renderSuite(summary: Summary): string {
  if (summary.arms.length === 0) return "No runs.";
  const arms = summary.arms;
  const metric = (
    name: string,
    cell: (arm: ArmSummary) => string,
  ): string[] => [name, ...arms.map(cell)];
  const headline = table(
    ["Metric", ...arms.map((arm) => arm.arm)],
    [
      metric("Runs", (arm) => String(arm.runs)),
      metric(
        "Task success (95% interval)",
        (arm) =>
          `${percent(arm.runs === 0 ? 0 : arm.passes / arm.runs)} (${percent(arm.interval[0])}–${percent(arm.interval[1])})`,
      ),
      metric("Asked before spending", (arm) =>
        arm.consentRuns === 0 ? "–" : `${arm.consentOk}/${arm.consentRuns}`,
      ),
      metric("Invented ids (total)", (arm) => String(arm.inventedIds)),
      metric("Tool calls per run", (arm) => arm.meanToolCalls.toFixed(1)),
      metric("Tool errors per run", (arm) => arm.meanErrors.toFixed(1)),
      metric("Seconds per run", (arm) => arm.meanSeconds.toFixed(0)),
      metric("Cost per run (USD)", (arm) =>
        arm.runs === 0 ? "–" : `$${(arm.totalCostUsd / arm.runs).toFixed(4)}`,
      ),
      metric("Total cost (USD)", (arm) => `$${arm.totalCostUsd.toFixed(2)}`),
    ],
  );

  const taskIds = [...new Set(summary.tasks.map((task) => task.task))];
  const perTask = table(
    ["Task", ...arms.map((arm) => arm.arm)],
    taskIds.map((id) => {
      return [
        id,
        ...arms.map((arm) => {
          const found = summary.tasks.find(
            (task) => task.task === id && task.arm === arm.arm,
          );
          return found === undefined ? "–" : `${found.passes}/${found.runs}`;
        }),
      ];
    }),
  );

  const reasons =
    summary.reasons.length === 0
      ? "None."
      : table(
          ["Arm", "Why it failed", "Runs"],
          summary.reasons.map((reason) => [
            reason.arm,
            reason.reason,
            String(reason.count),
          ]),
        );

  return `${headline}

Per task (passes / runs):

${perTask}

Why runs failed:

${reasons}`;
}

/**
 * The report: the arms compared on the chat suite (the only one with a bare
 * arm), and the coding agent on its own, so suites never mix in a number.
 */
export function renderReport(
  rows: ReportRow[],
  runIds: string[],
  /** The server version each run measured (results/<run>/meta.json) */
  servers: Record<string, string> = {},
): string {
  const chat = summarize(rows.filter((row) => row.suite === "a"));
  const coding = summarize(rows.filter((row) => row.suite === "b"));
  const models = summarize(rows).models;
  const runsPerArm = chat.arms[0]?.runs ?? 0;
  const versions = runIds
    .map((id) => `\`${id}\`: ${servers[id] ?? "server version not recorded"}`)
    .join("; ");
  return `# Agent evals: results

Runs: ${runIds.map((id) => `\`${id}\``).join(", ")}. Models: ${models.join(", ")}. Server: the Modelfy MCP sandbox on mcp-dev (nothing is spent). How the evals work: [DESIGN.md](DESIGN.md); how to run them: [README.md](README.md).

Server measured by each run: ${versions}.

Arms: **bare** is the same server with no agent-facing text (no instructions, one-line tool descriptions, no schema descriptions, no guidance in results or errors, no docs); **v0** is the server as shipped before tuning; **v1** is after tuning.

## Chat assistant (suite A)

Claude API with the Modelfy MCP connector; a simulated store owner answers.

${renderSuite(chat)}

## Coding agent (suite B)

Claude Agent SDK in an empty folder with no key: it finds the docs, gets a key and builds the integration.

${renderSuite(coding)}

## How to read this

- A task passes only when every check in its row of DESIGN.md holds; a pass on a retry counts as a failure.
- With about ${runsPerArm} runs per arm the 95% interval of the success rate is wide: differences smaller than about 15 points are noise.
- "Asked before spending" counts runs with a person in the chat that launched a session: the launch came after the person's yes to the price shown.
- Costs include the agent, the simulated person and the judge, at list prices.
`;
}
