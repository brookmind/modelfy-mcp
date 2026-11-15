import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DOC_PAGES } from "../../src/docs";
import { AgentErrorCodeSchema } from "../../src/mcp/errors";
import { call, connect } from "../helpers/worker";

const ContentSchema = z.array(
  z.object({ type: z.string(), text: z.string().optional() }),
);

function textOf(content: unknown): string {
  return ContentSchema.parse(content)
    .map((part) => part.text ?? "")
    .join("\n");
}

let address = 80;

/** A fresh sandbox key from its own address (5 keys per hour per address). */
async function sandboxKey(): Promise<string> {
  address += 1;
  const response = await call("/sandbox/keys", {
    method: "POST",
    headers: { "CF-Connecting-IP": `192.0.2.${address}` },
  });
  return z.object({ api_key: z.string() }).parse(await response.json()).api_key;
}

describe("the docs on the web", () => {
  it("/llms.txt links every page as Markdown on this deployment", async () => {
    const response = await call("/llms.txt");
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    expect(body).toMatch(/^# Modelfy MCP\n\n> /);
    for (const page of DOC_PAGES) {
      expect(body).toContain(`(https://mcp.test/docs/${page.slug}.md)`);
    }
  });

  it("serves a page as HTML, and as Markdown with .md or Accept", async () => {
    const html = await call("/docs/quickstart");
    const markdown = await call("/docs/quickstart.md");
    const negotiated = await call("/docs/quickstart", {
      headers: { Accept: "text/markdown" },
    });
    const htmlBody = await html.text();
    const markdownBody = await markdown.text();

    expect(html.headers.get("Content-Type")).toContain("text/html");
    expect(htmlBody).toContain('<h1 id="quickstart">Quickstart</h1>');
    expect(htmlBody).toContain('href="https://mcp.test/docs/connect"');
    expect(markdown.headers.get("Content-Type")).toContain("text/markdown");
    expect(markdownBody).toContain("(https://mcp.test/docs/connect.md)");
    expect(await negotiated.text()).toBe(markdownBody);
  });

  it("points production URLs at this deployment", async () => {
    const body = await (await call("/llms-full.txt")).text();

    expect(body).toContain("https://mcp.test/mcp");
    expect(body).toContain("https://web.test/plans");
    expect(body).not.toContain("mcp.modelfy.ai");
    expect(body).not.toContain("beta.modelfy.ai");
  });

  it("every error code's docs_url anchor exists", async () => {
    const body = await (await call("/docs/errors")).text();

    for (const code of AgentErrorCodeSchema.options) {
      expect(body).toContain(`id="${code}"`);
    }
  });

  it("an unknown page is a 404", async () => {
    expect((await call("/docs/nope")).status).toBe(404);
    expect((await call("/docs/nope.md")).status).toBe(404);
  });

  it("the index lists every page", async () => {
    const body = await (await call("/docs")).text();

    for (const page of DOC_PAGES) {
      expect(body).toContain(`href="/docs/${page.slug}"`);
    }
  });
});

describe("the docs inside the MCP connection", () => {
  it("get_docs lists the topics, then returns a page as Markdown", async () => {
    const client = await connect(await sandboxKey());

    const list = await client.callTool({ name: "get_docs", arguments: {} });
    const errors = await client.callTool({
      name: "get_docs",
      arguments: { topic: "errors" },
    });

    for (const page of DOC_PAGES) {
      expect(textOf(list.content)).toContain(`- ${page.slug}: `);
    }
    expect(errors.isError).toBeFalsy();
    expect(textOf(errors.content)).toContain("### BUDGET_EXCEEDED");
    expect(textOf(errors.content)).toContain(
      "Source: https://mcp.test/docs/errors",
    );
  });

  it("an unknown topic is an error that lists the real ones", async () => {
    const client = await connect(await sandboxKey());

    const result = await client.callTool({
      name: "get_docs",
      arguments: { topic: "pricing" },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result.content)).toContain("- credits: ");
  });

  it("each page is also a resource", async () => {
    const client = await connect(await sandboxKey());

    const { resources } = await client.listResources();
    const read = await client.readResource({
      uri: "modelfy://docs/credits",
    });

    expect(resources.map((resource) => resource.uri)).toEqual(
      DOC_PAGES.map((page) => `modelfy://docs/${page.slug}`),
    );
    expect(read.contents[0]).toMatchObject({
      uri: "modelfy://docs/credits",
      mimeType: "text/markdown",
    });
  });

  it("the server instructions point to get_docs", async () => {
    const client = await connect(await sandboxKey());

    expect(client.getInstructions()).toContain("get_docs");
  });
});
