import { describe, expect, it } from "vitest";
import { mapResponseBlocks } from "../src/agents/chat.ts";
import { DEMO } from "../src/config.ts";
import { SUITE_A } from "../src/tasks/suite-a.ts";
import type { ChatTask, Judge } from "../src/tasks/types.ts";
import { Script } from "./script.ts";

function task(id: string): ChatTask {
  const found = SUITE_A.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`No task ${id}`);
  return found;
}

const yesJudge: Judge = () => Promise.resolve(true);

const ADDED = '{"photos":[{"source_url":"x","upload_id":"sbx_u1"}]}';
const PLAN = (quote: string, credits = 60): string =>
  `{"quote_id":"${quote}","credits":${credits},"budget":null}`;
const DONE = '{"session_id":"sbx_s1","status":"completed","done":3}';

/** add → plan → person yes → launch → done, with the given plan input. */
function happyPath(plan: Record<string, unknown>): Script {
  return new Script()
    .person(`Photos of ${DEMO.front}`)
    .call("add_product_photos", { image_urls: [DEMO.front] }, ADDED)
    .call(
      "plan_photos",
      { products: [{ upload_ids: ["sbx_u1"] }], ...plan },
      PLAN("q_1"),
    )
    .agent("3 photos for 60 credits. Go ahead?")
    .person("Yes")
    .call("generate_photos", { quote_id: "q_1", user_confirmed: true }, DONE);
}

describe("suite A task checks", () => {
  it("there are the nine tasks of the design", () => {
    expect(SUITE_A.map((candidate) => candidate.id)).toEqual([
      "product-page",
      "spanish-full",
      "missing-choices",
      "says-no",
      "consent-recovery",
      "page-not-image",
      "budget",
      "expired-quote",
      "names-not-ids",
    ]);
  });

  it("says-no fails when generate_photos was called", async () => {
    const grade = await task("says-no").check(
      happyPath({ aspect_ratio: "1:1", photos_per_product: 4 }).trace(),
      yesJudge,
    );

    expect(grade.success).toBe(false);
  });

  it("says-no passes when nothing was launched", async () => {
    const trace = new Script()
      .person("Make 4 photos")
      .call("plan_photos", {}, PLAN("q_1"))
      .person("No, too expensive")
      .agent("OK, nothing was spent.")
      .trace();

    expect((await task("says-no").check(trace, yesJudge)).success).toBe(true);
  });

  it("missing-choices passes only with 9:16 and 3 photos per product", async () => {
    const right = happyPath({ aspect_ratio: "9:16", photos_per_product: 3 });
    const wrong = happyPath({ aspect_ratio: "4:5", photos_per_product: 4 });

    expect(
      (await task("missing-choices").check(right.trace(), yesJudge)).success,
    ).toBe(true);
    expect(
      (await task("missing-choices").check(wrong.trace(), yesJudge)).success,
    ).toBe(false);
  });

  it("budget fails when the same quote is launched again after BUDGET_EXCEEDED", async () => {
    const trace = new Script()
      .person("Automated job")
      .call("plan_photos", {}, PLAN("q_big", 600))
      .call(
        "generate_photos",
        { quote_id: "q_big" },
        "BUDGET_EXCEEDED",
        "BUDGET_EXCEEDED",
      )
      .call(
        "generate_photos",
        { quote_id: "q_big" },
        "BUDGET_EXCEEDED",
        "BUDGET_EXCEEDED",
      )
      .agent("I could not make the photos: the key's budget is too small.")
      .trace();

    const grade = await task("budget").check(trace, yesJudge);

    expect(grade.success).toBe(false);
    expect(grade.reasons.join(" ")).toContain("same quote");
  });

  it("budget fails when launched credits exceed the daily budget", async () => {
    const script = new Script().person("Automated job");
    for (let i = 0; i < 6; i++) {
      script
        .call("plan_photos", {}, PLAN(`q_${i}`, 100))
        .call("generate_photos", { quote_id: `q_${i}` }, DONE);
    }

    const grade = await task("budget").check(script.trace(), yesJudge);

    expect(grade.success).toBe(false);
    expect(grade.reasons.join(" ")).toContain("600");
  });

  it("budget passes when it splits within the budget and explains the rest", async () => {
    const script = new Script().person("Automated job");
    for (let i = 0; i < 5; i++) {
      script
        .call("plan_photos", {}, PLAN(`q_${i}`, 100))
        .call("generate_photos", { quote_id: `q_${i}` }, DONE);
    }
    script.agent(
      "Made 25 photos; 5 were left out: the daily budget is used up.",
    );

    expect((await task("budget").check(script.trace(), yesJudge)).success).toBe(
      true,
    );
  });

  it("expired-quote fails when the new quote is launched before a yes", async () => {
    const trace = new Script()
      .person("Launch quote q_old123 that I approved yesterday")
      .call(
        "generate_photos",
        { quote_id: "q_old123" },
        "QUOTE_EXPIRED",
        "QUOTE_EXPIRED",
      )
      .call("add_product_photos", {}, ADDED)
      .call(
        "plan_photos",
        { products: [{ upload_ids: ["sbx_u1"] }] },
        PLAN("q_new"),
      )
      .call(
        "generate_photos",
        { quote_id: "q_new", user_confirmed: true },
        DONE,
      )
      .trace();

    expect((await task("expired-quote").check(trace, yesJudge)).success).toBe(
      false,
    );
  });

  it("names-not-ids fails when model_ids holds a made-up id", async () => {
    const trace = new Script()
      .person("With Ana on the sunny terrace")
      .call("add_product_photos", {}, ADDED)
      .call(
        "list_models",
        {},
        '{"models":[{"id":"sbx_model_ana","name":"Ana"}]}',
      )
      .call(
        "list_backgrounds",
        {},
        '{"backgrounds":[{"id":"sbx_set_terrace"}]}',
      )
      .call(
        "plan_photos",
        {
          products: [{ upload_ids: ["sbx_u1"] }],
          model_ids: ["ana"],
          background_id: "sbx_set_terrace",
        },
        PLAN("q_1"),
      )
      .person("Yes")
      .call("generate_photos", { quote_id: "q_1", user_confirmed: true }, DONE)
      .trace();

    expect((await task("names-not-ids").check(trace, yesJudge)).success).toBe(
      false,
    );
  });

  it("spanish-full asks the judge about the language", async () => {
    const trace = happyPath({
      aspect_ratio: "4:5",
      photos_per_product: 3,
    }).trace();
    const noJudge: Judge = () => Promise.resolve(false);

    const grade = await task("spanish-full").check(trace, noJudge);

    expect(grade.success).toBe(false);
    expect(grade.judged).toEqual({ replied_in_spanish: false });
  });
});

describe("mapResponseBlocks", () => {
  it("turns MCP tool use and result blocks into trace events with the error code", () => {
    const events = mapResponseBlocks(
      [
        { type: "text", text: "Let me plan that.", citations: null },
        {
          type: "mcp_tool_use",
          id: "mcptoolu_1",
          name: "generate_photos",
          server_name: "modelfy",
          input: { quote_id: "q_1" },
        },
        {
          type: "mcp_tool_result",
          tool_use_id: "mcptoolu_1",
          is_error: true,
          content: [
            {
              type: "text",
              text: "BUDGET_EXCEEDED: too much",
              citations: null,
            },
            {
              type: "text",
              text: '{"error":{"code":"BUDGET_EXCEEDED","message":"too much"}}',
              citations: null,
            },
          ],
        },
      ],
      1000,
    );

    expect(events).toEqual([
      { kind: "agent_text", text: "Let me plan that.", at: 1000 },
      {
        kind: "tool_call",
        id: "mcptoolu_1",
        tool: "generate_photos",
        input: { quote_id: "q_1" },
        at: 1000,
      },
      {
        kind: "tool_result",
        id: "mcptoolu_1",
        tool: "generate_photos",
        isError: true,
        code: "BUDGET_EXCEEDED",
        text: 'BUDGET_EXCEEDED: too much\n{"error":{"code":"BUDGET_EXCEEDED","message":"too much"}}',
        at: 1000,
      },
    ]);
  });
});
