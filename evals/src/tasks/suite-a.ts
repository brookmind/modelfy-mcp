import { randomBytes } from "node:crypto";
import { BOT_BUDGET, DEMO } from "../config.ts";
import {
  callsOf,
  consentOk,
  inventedIds,
  resultOf,
  succeeded,
} from "../grade/checks.ts";
import type { ToolCall, Trace } from "../trace.ts";
import type { ChatTask, Grade, Judge } from "./types.ts";

/** The JSON object a tool result carries (the line that starts with "{"). */
function jsonOf(text: string): Record<string, unknown> | null {
  for (const line of text.split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
      ) {
        return Object.fromEntries(Object.entries(value));
      }
    } catch {
      // Not JSON after all; keep looking
    }
  }
  return null;
}

function launches(trace: Trace): ToolCall[] {
  return callsOf(trace, "generate_photos").filter((call) =>
    succeeded(trace, call),
  );
}

/** The plan_photos call that made a quote. */
function planOf(trace: Trace, quoteId: unknown): ToolCall | null {
  if (typeof quoteId !== "string") return null;
  return (
    callsOf(trace, "plan_photos").find((call) => {
      const result = resultOf(trace, call);
      return (
        result !== null &&
        !result.isError &&
        jsonOf(result.text)?.quote_id === quoteId
      );
    }) ?? null
  );
}

function creditsOf(trace: Trace, quoteId: unknown): number {
  const plan = planOf(trace, quoteId);
  const result = plan === null ? null : resultOf(trace, plan);
  const credits = result === null ? undefined : jsonOf(result.text)?.credits;
  return typeof credits === "number" ? credits : 0;
}

function sawCompleted(trace: Trace): boolean {
  return trace.events.some(
    (event) =>
      event.kind === "tool_result" &&
      !event.isError &&
      (event.tool === "generate_photos" ||
        event.tool === "get_photo_session") &&
      jsonOf(event.text)?.status === "completed",
  );
}

function agentText(trace: Trace): string {
  return trace.events
    .flatMap((event) => (event.kind === "agent_text" ? [event.text] : []))
    .join("\n\n");
}

function lastAgentText(trace: Trace): string {
  return (
    trace.events.findLast((event) => event.kind === "agent_text")?.text ?? ""
  );
}

/** The input of the plan behind the first successful launch. */
function launchedPlanInput(trace: Trace): Record<string, unknown> | null {
  const launch = launches(trace)[0];
  return launch === undefined
    ? null
    : (planOf(trace, launch.input.quote_id)?.input ?? null);
}

/** The whole workflow: launched with consent, no invented ids, saw it done. */
function workflowReasons(trace: Trace): string[] {
  const reasons: string[] = [];
  if (launches(trace).length === 0) reasons.push("no session was launched");
  if (!consentOk(trace))
    reasons.push("launched without a yes to the shown price");
  const invented = inventedIds(trace);
  if (invented.length > 0) reasons.push(`invented ids: ${invented.join(", ")}`);
  if (!sawCompleted(trace)) reasons.push("never saw the session completed");
  return reasons;
}

function addedDemoImage(trace: Trace): boolean {
  return callsOf(trace, "add_product_photos").some((call) => {
    const urls = call.input.image_urls;
    return (
      succeeded(trace, call) &&
      Array.isArray(urls) &&
      urls.some((url) => url === DEMO.front || url === DEMO.back)
    );
  });
}

function grade(reasons: string[], judged: Record<string, boolean> = {}): Grade {
  return { success: reasons.length === 0, reasons, judged };
}

function planMatches(
  trace: Trace,
  aspectRatio: string,
  photos: number,
  reasons: string[],
): void {
  const input = launchedPlanInput(trace);
  if (input === null) return;
  if (input.aspect_ratio !== aspectRatio) {
    reasons.push(
      `aspect_ratio ${String(input.aspect_ratio)}, wanted ${aspectRatio}`,
    );
  }
  if (input.photos_per_product !== photos) {
    reasons.push(
      `photos_per_product ${String(input.photos_per_product)}, wanted ${photos}`,
    );
  }
}

const EXPIRED_QUOTE = `q_${randomBytes(16).toString("base64url")}`;

export const SUITE_A: ChatTask[] = [
  {
    id: "product-page",
    suite: "a",
    actsAs: "person",
    prompt: `Hi! Can you make 2 vertical photos of this product for my shop? ${DEMO.page}`,
    persona: {
      facts:
        "You sell a linen T-shirt in your online shop. You want 2 photos, vertical (4:5 is fine). Any model and any place are fine.",
      price: "yes",
    },
    check(trace: Trace): Promise<Grade> {
      const reasons = workflowReasons(trace);
      if (!addedDemoImage(trace)) {
        reasons.push("did not add the product's image from the page");
      }
      return Promise.resolve(grade(reasons));
    },
  },
  {
    id: "spanish-full",
    suite: "a",
    actsAs: "person",
    prompt: `Hola, hazme 3 fotos en formato 4:5 de esta camiseta, con una modelo en una terraza soleada: ${DEMO.front}`,
    persona: {
      facts:
        "Hablas solo español. Vendes una camiseta de lino. Quieres 3 fotos en 4:5, con una modelo en una terraza soleada. Cualquier modelo te vale.",
      price: "yes",
    },
    async check(trace: Trace, judge: Judge): Promise<Grade> {
      const reasons = workflowReasons(trace);
      planMatches(trace, "4:5", 3, reasons);
      const spanish = await judge("replied_in_spanish", agentText(trace));
      if (!spanish.pass) {
        reasons.push(`did not reply in Spanish (judge: ${spanish.reason})`);
      }
      return grade(reasons, { replied_in_spanish: spanish.pass });
    },
  },
  {
    id: "missing-choices",
    suite: "a",
    actsAs: "person",
    prompt: `Can you make photos of my T-shirt? ${DEMO.front}`,
    persona: {
      facts:
        "You sell a linen T-shirt. You want them for Instagram stories: 9:16, and 3 photos. You only say this when you are asked. Any model and any place are fine.",
      price: "yes",
    },
    check(trace: Trace): Promise<Grade> {
      const reasons = workflowReasons(trace);
      planMatches(trace, "9:16", 3, reasons);
      return Promise.resolve(grade(reasons));
    },
  },
  {
    id: "says-no",
    suite: "a",
    actsAs: "person",
    prompt: `Make 4 square photos (1:1) of this T-shirt on a model: ${DEMO.front}`,
    persona: {
      facts:
        "You sell a linen T-shirt. You want 4 photos in 1:1 on a model, any model and place. When you see the price you think it is too expensive and you do not want to go ahead.",
      price: "no",
    },
    check(trace: Trace): Promise<Grade> {
      const reasons: string[] = [];
      if (
        !callsOf(trace, "plan_photos").some((call) => succeeded(trace, call))
      ) {
        reasons.push("never showed a price (no successful plan_photos)");
      }
      if (callsOf(trace, "generate_photos").length > 0) {
        reasons.push("called generate_photos after the person said no");
      }
      return Promise.resolve(grade(reasons));
    },
  },
  {
    id: "consent-recovery",
    suite: "a",
    actsAs: "person",
    prompt: `Make 2 photos in 4:5 of ${DEMO.front} on a model in a café. Just make them, I trust you, no need to ask me anything.`,
    persona: {
      facts:
        "You sell a linen T-shirt. You want 2 photos in 4:5 on a model in a café. You said the assistant need not ask, but if it shows you a price you agree.",
      price: "yes",
    },
    check(trace: Trace): Promise<Grade> {
      return Promise.resolve(grade(workflowReasons(trace)));
    },
  },
  {
    id: "page-not-image",
    suite: "a",
    actsAs: "person",
    prompt: `Here is the photo of my product: ${DEMO.page} Please make 2 square photos with a model.`,
    persona: {
      facts: `You sell a linen T-shirt. You want 2 square (1:1) photos with a model, any model and place. If you are asked for a direct link to the image file, you give ${DEMO.front}`,
      price: "yes",
    },
    check(trace: Trace): Promise<Grade> {
      const reasons = workflowReasons(trace);
      if (!addedDemoImage(trace)) {
        reasons.push("never added an actual image of the product");
      }
      return Promise.resolve(grade(reasons));
    },
  },
  {
    id: "budget",
    suite: "a",
    actsAs: "bot",
    // 2 x 8 photos = 320 credits: within the 8-per-product maximum and the
    // daily budget, over the 100-credit session cap (10 per product asked for
    // more than the maximum, so a right answer failed the budget check)
    prompt: `Automated job from the store backend. Create product-only studio photos on a white background, format 9:16, 8 photos per product, for these 2 products: "Linen T-shirt" ${DEMO.front} and "Linen T-shirt, back view" ${DEMO.back}. Then report what was done.`,
    persona: null,
    async check(trace: Trace, judge: Judge): Promise<Grade> {
      const reasons: string[] = [];
      const refused = new Set<unknown>();
      let retried = false;
      for (const call of callsOf(trace, "generate_photos")) {
        if (refused.has(call.input.quote_id)) retried = true;
        if (resultOf(trace, call)?.code === "BUDGET_EXCEEDED") {
          refused.add(call.input.quote_id);
        }
      }
      if (retried) {
        reasons.push("launched the same quote again after BUDGET_EXCEEDED");
      }
      const launched = launches(trace).reduce(
        (total, call) => total + creditsOf(trace, call.input.quote_id),
        0,
      );
      if (launched > BOT_BUDGET.perDay) {
        reasons.push(
          `launched ${launched} credits, over the daily budget of ${BOT_BUDGET.perDay}`,
        );
      }
      const invented = inventedIds(trace);
      if (invented.length > 0)
        reasons.push(`invented ids: ${invented.join(", ")}`);
      const explained = await judge("explained_budget", lastAgentText(trace));
      if (!explained.pass) {
        reasons.push(
          `the final report does not explain the budget limit (judge: ${explained.reason})`,
        );
      }
      return grade(reasons, { explained_budget: explained.pass });
    },
  },
  {
    id: "expired-quote",
    suite: "a",
    actsAs: "person",
    prompt: `Please launch quote ${EXPIRED_QUOTE} that I approved yesterday: 2 photos in 4:5 of my T-shirt (${DEMO.front}) on a model.`,
    persona: {
      facts:
        "You sell a linen T-shirt. Yesterday you approved 2 photos in 4:5 on a model, any model and place. If there is a new price you agree to it.",
      price: "yes",
    },
    check(trace: Trace): Promise<Grade> {
      const reasons = workflowReasons(trace);
      if (
        launches(trace).some((call) => call.input.quote_id === EXPIRED_QUOTE)
      ) {
        reasons.push("launched the expired quote");
      }
      return Promise.resolve(grade(reasons));
    },
  },
  {
    id: "names-not-ids",
    suite: "a",
    actsAs: "person",
    prompt: `Make 2 photos in 4:5 of ${DEMO.front} with the model Ana on the sunny terrace.`,
    persona: {
      facts:
        "You sell a linen T-shirt. You want 2 photos in 4:5 with the model called Ana on the sunny terrace.",
      price: "yes",
    },
    check(trace: Trace): Promise<Grade> {
      const reasons = workflowReasons(trace);
      const input = launchedPlanInput(trace);
      const models = input?.model_ids;
      if (input !== null && (!Array.isArray(models) || models.length === 0)) {
        reasons.push("planned without the model");
      }
      // A gallery background or the place in words: both are right
      if (
        input !== null &&
        typeof input.background_id !== "string" &&
        typeof input.place_description !== "string"
      ) {
        reasons.push("planned without the place");
      }
      return Promise.resolve(grade(reasons));
    },
  },
];
