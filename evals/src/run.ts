// Runs the evals: npm run eval -- --suite a|b|all --arm v0|bare --reps N
//   [--tasks id,id] [--run-id id] [--concurrency N]
// Needs ANTHROPIC_API_KEY. Reuse --run-id to resume a run that stopped.
import Anthropic from "@anthropic-ai/sdk";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { runChat } from "./agents/chat.ts";
import { KV_WRITES_PER_DAY } from "./config.ts";
import { makeJudge } from "./grade/judge.ts";
import {
  appendRow,
  doneKeys,
  metricsOf,
  rowKey,
  type ResultRow,
} from "./results.ts";
import { createSandboxKey, type AgentLayer } from "./sandbox-key.ts";
import { SUITE_A } from "./tasks/suite-a.ts";
import type { Grade } from "./tasks/types.ts";
import type { Trace, Usage } from "./trace.ts";

const EVALS_DIR = join(import.meta.dirname, "..");
/** KV writes reserved for a run before it starts (a long run writes ~20). */
const KV_RESERVE_PER_RUN = 25;

/** One task the runner can run, whatever its suite. */
export interface Job {
  task: string;
  suite: "a" | "b";
  run(
    client: Anthropic,
    arm: AgentLayer,
  ): Promise<{ trace: Trace; grade: Grade; extraUsages: Usage[] }>;
}

const SUITE_A_JOBS: Job[] = SUITE_A.map((task) => ({
  task: task.id,
  suite: "a",
  async run(client, arm) {
    const key = await createSandboxKey({
      actsAs: task.actsAs,
      agentLayer: arm,
    });
    const trace = await runChat(client, task, key);
    const extraUsages: Usage[] = [];
    const grade = await task.check(trace, makeJudge(client, extraUsages));
    return { trace, grade, extraUsages };
  },
}));

/** Suite B jobs are added by agents/coder.ts (Task 9). */
export const JOBS: Job[] = [...SUITE_A_JOBS];

function tallyPath(now: Date = new Date()): string {
  return join(
    EVALS_DIR,
    ".secrets",
    `kv-writes-${now.toISOString().slice(0, 10)}.json`,
  );
}

async function kvWritesToday(): Promise<number> {
  try {
    const value: unknown = JSON.parse(await readFile(tallyPath(), "utf8"));
    return typeof value === "object" &&
      value !== null &&
      "writes" in value &&
      typeof value.writes === "number"
      ? value.writes
      : 0;
  } catch {
    return 0;
  }
}

async function addKvWrites(writes: number): Promise<void> {
  const path = tallyPath();
  await mkdir(join(EVALS_DIR, ".secrets"), { recursive: true });
  await writeFile(
    path,
    JSON.stringify({ writes: (await kvWritesToday()) + writes }),
  );
}

interface Pending {
  job: Job;
  rep: number;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      suite: { type: "string", default: "a" },
      arm: { type: "string", default: "v0" },
      reps: { type: "string", default: "1" },
      tasks: { type: "string" },
      "run-id": { type: "string" },
      concurrency: { type: "string", default: "3" },
    },
  });
  const arm: AgentLayer = values.arm === "bare" ? "bare" : "v0";
  const reps = Number.parseInt(values.reps, 10);
  const concurrency = Number.parseInt(values.concurrency, 10);
  const wanted = values.tasks?.split(",") ?? null;
  const runId =
    values["run-id"] ?? new Date().toISOString().replace(/[:.]/g, "-");
  const resultsPath = join(EVALS_DIR, "results", runId, "results.jsonl");

  const jobs = JOBS.filter(
    (job) =>
      (values.suite === "all" || job.suite === values.suite) &&
      (wanted === null || wanted.includes(job.task)) &&
      // The bare arm exists for the chat suite only
      (arm === "v0" || job.suite === "a"),
  );
  const done = await doneKeys(resultsPath);
  const pending: Pending[] = [];
  for (let rep = 0; rep < reps; rep++) {
    for (const job of jobs) {
      if (!done.has(rowKey(job.task, arm, rep))) pending.push({ job, rep });
    }
  }
  console.log(
    `run ${runId}: ${pending.length} runs to do (${done.size} already done)`,
  );

  const client = new Anthropic({ maxRetries: 4 });
  let stopped = false;
  const worker = async (): Promise<void> => {
    for (
      let next = pending.shift();
      next !== undefined && !stopped;
      next = pending.shift()
    ) {
      if ((await kvWritesToday()) + KV_RESERVE_PER_RUN > KV_WRITES_PER_DAY) {
        stopped = true;
        console.log(
          "stopping: the dev Worker's KV write budget for today is used up; rerun with the same --run-id tomorrow",
        );
        return;
      }
      const { job, rep } = next;
      try {
        const { trace, grade, extraUsages } = await job.run(client, arm);
        const metrics = metricsOf(trace, extraUsages);
        await addKvWrites(metrics.kvWrites);
        const row: ResultRow = {
          runId,
          task: job.task,
          suite: job.suite,
          arm,
          rep,
          models: [
            ...new Set(
              trace.events.flatMap((event) =>
                event.kind === "usage" ? [event.model] : [],
              ),
            ),
          ],
          grade,
          metrics,
          trace,
        };
        await appendRow(resultsPath, row);
        console.log(
          `${grade.success ? "PASS" : "FAIL"} ${job.task} #${rep} ${metrics.toolCalls} calls $${metrics.costUsd.toFixed(4)} ${metrics.seconds.toFixed(0)}s${grade.reasons.length > 0 ? ` — ${grade.reasons.join("; ")}` : ""}`,
        );
      } catch (error) {
        // Not written: a rerun with the same --run-id tries it again
        console.log(
          `ERROR ${job.task} #${rep}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  console.log(`results: ${resultsPath}`);
}

await main();
