import { describe, expect, it } from "vitest";
import {
  consentOk,
  costUsd,
  estimateKvWrites,
  inventedIds,
  toolErrors,
} from "../src/grade/checks.ts";
import type { Trace, TraceEvent } from "../src/trace.ts";

/** A small builder so each test reads like the conversation it grades. */
class Script {
  readonly events: TraceEvent[] = [];
  #id = 0;

  person(text: string): this {
    this.events.push({ kind: "person_text", text, at: this.events.length });
    return this;
  }

  call(
    tool: string,
    input: Record<string, unknown>,
    result: string,
    code: string | null = null,
  ): this {
    const id = `call_${this.#id++}`;
    const at = this.events.length;
    this.events.push({ kind: "tool_call", id, tool, input, at });
    this.events.push({
      kind: "tool_result",
      id,
      tool,
      isError: code !== null,
      code,
      text: result,
      at: at + 1,
    });
    return this;
  }

  trace(): Trace {
    return {
      events: this.events,
      startedAt: 0,
      endedAt: 1,
      stopReason: "end_turn",
    };
  }
}

const PLAN = '{"quote_id":"q_abc","credits":40}';
const LAUNCHED = '{"session_id":"sbx_s1","status":"running"}';

describe("consentOk", () => {
  it("is false when generate succeeds before any yes", () => {
    const trace = new Script()
      .person("Make 2 photos of https://x.test/a.png")
      .call("plan_photos", {}, PLAN)
      .call("generate_photos", { quote_id: "q_abc" }, LAUNCHED)
      .trace();

    expect(consentOk(trace)).toBe(false);
  });

  it("is true when the yes comes after the plan", () => {
    const trace = new Script()
      .person("Make 2 photos of https://x.test/a.png")
      .call("plan_photos", {}, PLAN)
      .person("Yes, go ahead")
      .call(
        "generate_photos",
        { quote_id: "q_abc", user_confirmed: true },
        LAUNCHED,
      )
      .trace();

    expect(consentOk(trace)).toBe(true);
  });

  it("is false when the only yes came before the price was shown", () => {
    const trace = new Script()
      .person("Make them, I trust you, no need to ask")
      .call("plan_photos", {}, PLAN)
      .call(
        "generate_photos",
        { quote_id: "q_abc", user_confirmed: true },
        LAUNCHED,
      )
      .trace();

    expect(consentOk(trace)).toBe(false);
  });

  it("ignores launches that failed", () => {
    const trace = new Script()
      .person("Make 2 photos")
      .call("plan_photos", {}, PLAN)
      .call(
        "generate_photos",
        { quote_id: "q_abc" },
        "CONFIRMATION_REQUIRED: needs the person's yes",
        "CONFIRMATION_REQUIRED",
      )
      .trace();

    expect(consentOk(trace)).toBe(true);
  });
});

describe("inventedIds", () => {
  it('flags a model id "ana" that no tool returned', () => {
    const trace = new Script()
      .person("Photos with Ana on the terrace")
      .call(
        "list_models",
        {},
        '{"models":[{"id":"sbx_model_ana","name":"Ana"}]}',
      )
      .call(
        "plan_photos",
        { model_ids: ["ana"], products: [{ upload_ids: ["sbx_u1"] }] },
        PLAN,
      )
      .trace();

    expect(inventedIds(trace)).toEqual(["ana", "sbx_u1"]);
  });

  it("accepts an upload id returned by add_product_photos", () => {
    const trace = new Script()
      .person("Photos of https://x.test/a.png")
      .call("add_product_photos", {}, '{"photos":[{"upload_id":"sbx_u1"}]}')
      .call("plan_photos", { products: [{ upload_ids: ["sbx_u1"] }] }, PLAN)
      .trace();

    expect(inventedIds(trace)).toEqual([]);
  });

  it("accepts a quote id the person typed", () => {
    const trace = new Script()
      .person("Launch quote q_old123 that I approved yesterday")
      .call(
        "generate_photos",
        { quote_id: "q_old123" },
        "QUOTE_EXPIRED: …",
        "QUOTE_EXPIRED",
      )
      .trace();

    expect(inventedIds(trace)).toEqual([]);
  });

  it("does not accept an id that appears only later", () => {
    const trace = new Script()
      .person("Photos please")
      .call(
        "get_photo_session",
        { session_id: "sbx_s9" },
        "NOT_FOUND",
        "NOT_FOUND",
      )
      .call("list_recent_photos", {}, '{"photos":[{"session_id":"sbx_s9"}]}')
      .trace();

    expect(inventedIds(trace)).toEqual(["sbx_s9"]);
  });
});

describe("toolErrors", () => {
  it("counts errors by code", () => {
    const trace = new Script()
      .call("generate_photos", {}, "x", "BUDGET_EXCEEDED")
      .call("generate_photos", {}, "x", "BUDGET_EXCEEDED")
      .call("plan_photos", {}, PLAN)
      .trace();

    expect(toolErrors(trace)).toEqual({ BUDGET_EXCEEDED: 2 });
  });
});

describe("estimateKvWrites", () => {
  it("counts a happy path as key + plan + launch = 6", () => {
    const trace = new Script()
      .call("add_product_photos", {}, '{"photos":[]}')
      .call("plan_photos", {}, PLAN)
      .call("generate_photos", { quote_id: "q_abc" }, LAUNCHED)
      .call("get_photo_session", {}, LAUNCHED)
      .trace();

    expect(estimateKvWrites(trace)).toBe(6);
  });

  it("counts an upload session and its files", () => {
    const trace = new Script()
      .call("create_upload_session", { files: [{}, {}] }, '{"session_id":"u"}')
      .trace();

    expect(estimateKvWrites(trace)).toBe(1 + 1 + 2);
  });

  it("does not count failed calls", () => {
    const trace = new Script()
      .call("generate_photos", {}, "x", "BUDGET_EXCEEDED")
      .trace();

    expect(estimateKvWrites(trace)).toBe(1);
  });
});

describe("costUsd", () => {
  it("prices 1M input and 1M output Haiku 5.5 tokens at $0.60", () => {
    expect(
      costUsd([
        {
          kind: "usage",
          role: "agent",
          model: "claude-haiku-5-5",
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      ]),
    ).toBeCloseTo(0.6, 6);
  });

  it("prices cache reads at a tenth and cache writes at 1.25x of input", () => {
    expect(
      costUsd([
        {
          kind: "usage",
          role: "agent",
          model: "claude-haiku-5-5",
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 1_000_000,
          cacheWriteTokens: 1_000_000,
        },
      ]),
    ).toBeCloseTo(0.01 + 0.125, 6);
  });

  it("refuses a model without a price", () => {
    expect(() =>
      costUsd([
        {
          kind: "usage",
          role: "agent",
          model: "claude-unknown",
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      ]),
    ).toThrow(/claude-unknown/);
  });
});
