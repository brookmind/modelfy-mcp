import type { ActsAs } from "../sandbox-key.ts";
import type { Trace } from "../trace.ts";

/** What the simulated person knows and how they answer the price. */
export interface Persona {
  /** Facts in the person's own words; they answer only from these */
  facts: string;
  price: "yes" | "no";
}

export interface Grade {
  success: boolean;
  /** Why it failed (empty on success) */
  reasons: string[];
  /** LLM-judge answers, by question */
  judged: Record<string, boolean>;
}

export type JudgeQuestion = "replied_in_spanish" | "explained_budget";

/** Asks the judge one question about the agent's messages. */
export type Judge = (
  question: JudgeQuestion,
  agentText: string,
) => Promise<boolean>;

export interface ChatTask {
  id: string;
  suite: "a";
  actsAs: ActsAs;
  /** The first message, from the person (or the bot's job) */
  prompt: string;
  /** null for a bot: one message, nobody answers */
  persona: Persona | null;
  check(trace: Trace, judge: Judge): Promise<Grade>;
}
