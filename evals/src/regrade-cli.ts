// Grades stored chat runs again with the current graders, without running
// the agents again: npm run regrade -- <run-id> [<run-id>…]
// Only the judge is called (Claude Haiku 5.5, a few cents). Suite B rows keep
// their grade: it depends on the run folder, which is gone.
import Anthropic from "@anthropic-ai/sdk";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeJudge } from "./grade/judge.ts";
import {
  metricsOf,
  redact,
  ResultRowSchema,
  type ResultRow,
} from "./results.ts";
import { SUITE_A } from "./tasks/suite-a.ts";
import type { Usage } from "./trace.ts";

const EVALS_DIR = join(import.meta.dirname, "..");

async function regrade(client: Anthropic, runId: string): Promise<void> {
  const path = join(EVALS_DIR, "results", runId, "results.jsonl");
  const rows: ResultRow[] = (await readFile(path, "utf8"))
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => ResultRowSchema.parse(JSON.parse(line)));
  let changed = 0;
  for (const row of rows) {
    const task = SUITE_A.find((candidate) => candidate.id === row.task);
    if (row.suite !== "a" || task === undefined) continue;
    const judgeUsages: Usage[] = [];
    const grade = await task.check(row.trace, makeJudge(client, judgeUsages));
    if (grade.success !== row.grade.success) changed += 1;
    row.grade = grade;
    row.metrics = metricsOf(row.trace, judgeUsages);
  }
  const temporary = `${path}.tmp`;
  await writeFile(
    temporary,
    rows.map((row) => `${redact(JSON.stringify(row))}\n`).join(""),
  );
  await rename(temporary, path);
  console.log(`${runId}: ${rows.length} rows, ${changed} grades changed`);
}

const runIds = process.argv.slice(2);
if (runIds.length === 0) {
  console.error("Usage: npm run regrade -- <run-id> [<run-id>…]");
  process.exit(1);
}
const client = new Anthropic({ maxRetries: 4 });
for (const runId of runIds) await regrade(client, runId);
