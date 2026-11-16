// Writes the report: npm run report -- <run-id> [<run-id>…]
// Reads evals/results/<run-id>/results.jsonl, writes a summary.json next to
// each and evals/REPORT.md for all the given runs together.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { renderReport, summarize, type ReportRow } from "./report.ts";

const EVALS_DIR = join(import.meta.dirname, "..");

const RowSchema = z.object({
  task: z.string(),
  suite: z.enum(["a", "b"]),
  arm: z.enum(["v0", "bare"]),
  rep: z.number(),
  models: z.array(z.string()),
  grade: z.object({
    success: z.boolean(),
    reasons: z.array(z.string()),
    judged: z.record(z.string(), z.boolean()),
  }),
  metrics: z.object({
    toolCalls: z.number(),
    toolErrors: z.record(z.string(), z.number()),
    personTurns: z.number(),
    inventedIds: z.array(z.string()),
    consentOk: z.boolean().nullable(),
    seconds: z.number(),
    costUsd: z.number(),
    tokens: z.object({
      input: z.number(),
      output: z.number(),
      cacheRead: z.number(),
      cacheWrite: z.number(),
    }),
    kvWrites: z.number(),
  }),
});

async function rowsOf(runId: string): Promise<ReportRow[]> {
  const text = await readFile(
    join(EVALS_DIR, "results", runId, "results.jsonl"),
    "utf8",
  );
  return text.split("\n").flatMap((line) => {
    if (line.trim() === "") return [];
    try {
      const parsed = RowSchema.safeParse(JSON.parse(line));
      return parsed.success ? [parsed.data] : [];
    } catch {
      return [];
    }
  });
}

const runIds = process.argv.slice(2);
if (runIds.length === 0) {
  console.error("Usage: npm run report -- <run-id> [<run-id>…]");
  process.exit(1);
}
const all: ReportRow[] = [];
for (const runId of runIds) {
  const rows = await rowsOf(runId);
  all.push(...rows);
  await writeFile(
    join(EVALS_DIR, "results", runId, "summary.json"),
    `${JSON.stringify(summarize(rows), null, 2)}\n`,
  );
}
await writeFile(
  join(EVALS_DIR, "REPORT.md"),
  renderReport(summarize(all), runIds),
);
console.log(`REPORT.md from ${all.length} runs`);
