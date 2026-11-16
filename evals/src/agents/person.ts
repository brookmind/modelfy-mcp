import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { PERSON_MODEL } from "../config.ts";
import type { Persona } from "../tasks/types.ts";
import type { Trace, Usage } from "../trace.ts";
import { structured } from "./structured.ts";

export interface PersonTurn {
  /** What the person says next, or null when they have nothing to say */
  reply: string | null;
  /** The conversation is over: the assistant finished or gave up */
  done: boolean;
  usage: Usage;
}

const TurnSchema = z.object({
  reply: z.string().nullable(),
  done: z.boolean(),
});

const TURN_JSON_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: ["string", "null"] },
    done: { type: "boolean" },
  },
  required: ["reply", "done"],
  additionalProperties: false,
};

function system(persona: Persona): string {
  const price =
    persona.price === "yes"
      ? "When the assistant shows you a price in credits and asks whether to go ahead, say yes."
      : "When the assistant shows you a price in credits and asks whether to go ahead, say no: it is too expensive for you.";
  return `You play a store owner chatting with an AI assistant that creates product photos for you. You are not an assistant; you are the customer.

What you know and want:
${persona.facts}

${price}

Rules:
- Answer only from what you know above, in one or two short sentences, in the language of the facts.
- If the assistant asks something you do not know, say it can choose.
- Never invent ids, links or technical details.
- Set done to true and reply to null when the assistant has finished the job (it showed the photos or a final result), gave up, or has nothing left to ask you. Otherwise set done to false and give your reply.`;
}

/** The conversation as the person saw it: their messages and the assistant's. */
export function transcript(trace: Trace): string {
  return trace.events
    .flatMap((event) => {
      if (event.kind === "person_text") return [`You: ${event.text}`];
      if (event.kind === "agent_text") return [`Assistant: ${event.text}`];
      return [];
    })
    .join("\n\n");
}

export async function nextPersonTurn(
  client: Anthropic,
  persona: Persona,
  trace: Trace,
): Promise<PersonTurn> {
  const answer = await structured(client, {
    model: PERSON_MODEL,
    role: "person",
    system: system(persona),
    prompt: `The conversation so far:\n\n${transcript(trace)}\n\nWhat do you say next?`,
    jsonSchema: TURN_JSON_SCHEMA,
    parse: TurnSchema,
  });
  return { ...answer.value, usage: answer.usage };
}
