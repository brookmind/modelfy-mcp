import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { structured } from "../agents/structured.ts";
import { JUDGE_MODEL } from "../config.ts";
import type { Judge, JudgeQuestion } from "../tasks/types.ts";
import type { Usage } from "../trace.ts";

/** Checkable claims only; the judge answers whether the text meets them. */
const RUBRICS: Record<JudgeQuestion, string> = {
  replied_in_spanish:
    "Every message the assistant wrote to the person is in Spanish (product names, ids and links may stay as they are).",
  explained_budget:
    "The final report says that the key's credit budget limited the job (some or none of the requested photos were made because of it), and says what was done or what was left out.",
};

const VerdictSchema = z.object({ reason: z.string(), pass: z.boolean() });

// The reason comes first, so the verdict follows the reasoning (the pilot
// baseline had verdicts that contradicted their own reason)
const VERDICT_JSON_SCHEMA = {
  type: "object",
  properties: { reason: { type: "string" }, pass: { type: "boolean" } },
  required: ["reason", "pass"],
  additionalProperties: false,
};

/** A judge that records the tokens it spends into `usages`. */
export function makeJudge(client: Anthropic, usages: Usage[]): Judge {
  return async (question, agentText) => {
    const answer = await structured(client, {
      model: JUDGE_MODEL,
      role: "judge",
      system:
        "You grade an AI assistant's messages against one claim. First write the reason: one or two sentences on whether the claim holds. Then set pass to true if the claim holds and false if it does not; pass must agree with your reason.",
      prompt: `Claim: ${RUBRICS[question]}\n\nThe assistant's messages:\n\n${agentText === "" ? "(no messages)" : agentText}`,
      jsonSchema: VERDICT_JSON_SCHEMA,
      parse: VerdictSchema,
    });
    usages.push(answer.usage);
    return answer.value;
  };
}
