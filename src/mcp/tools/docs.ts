import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  DOC_PAGES,
  DOC_SLUGS,
  docMarkdown,
  docUrl,
  findDoc,
  type DocUrls,
} from "../../docs";
import type { Session } from "../session";

const DocsInput = z.object({
  topic: z
    .string()
    .optional()
    .describe(
      `One of: ${DOC_SLUGS.join(", ")}. Leave it out for the list of topics.`,
    ),
});

function text(value: string): CallToolResult {
  return { content: [{ type: "text", text: value }] };
}

function topicList(urls: DocUrls): string {
  const lines = DOC_PAGES.map(
    (page) => `- ${page.slug}: ${page.title}. ${page.description}`,
  );
  return `Modelfy docs. Call get_docs with one of these topics:\n${lines.join("\n")}\n\nAll of them on the web: ${urls.publicUrl}/llms-full.txt`;
}

/**
 * The documentation, inside the connection: a get_docs tool (every client
 * shows tools to the model) and the same pages as resources.
 */
export function registerDocs(server: McpServer, session: Session): void {
  const urls: DocUrls = {
    publicUrl: session.env.PUBLIC_URL,
    webUrl: session.env.WEB_URL,
  };

  server.registerTool(
    "get_docs",
    {
      title: "Modelfy docs",
      description:
        "Modelfy's documentation as Markdown: how to connect, keys, the photo workflow, credits and consent, and what each error code means and how to fix it. Read it when unsure how to do something or after an error. Free.",
      inputSchema: DocsInput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ topic }) => {
      if (topic === undefined || topic === "") {
        return Promise.resolve(text(topicList(urls)));
      }
      const page = findDoc(topic);
      if (page === null) {
        return Promise.resolve({
          ...text(`Unknown topic "${topic}". ${topicList(urls)}`),
          isError: true,
        });
      }
      return Promise.resolve(
        text(`${docMarkdown(page, urls)}\nSource: ${docUrl(page.slug, urls)}`),
      );
    },
  );

  for (const page of DOC_PAGES) {
    const uri = `modelfy://docs/${page.slug}`;
    server.registerResource(
      `docs-${page.slug}`,
      uri,
      {
        title: page.title,
        description: page.description,
        mimeType: "text/markdown",
      },
      () => ({
        contents: [
          { uri, mimeType: "text/markdown", text: docMarkdown(page, urls) },
        ],
      }),
    );
  }
}
