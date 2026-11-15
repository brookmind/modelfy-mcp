import { Marked } from "marked";
import { escapeHtml, htmlPage } from "../pages/layout";
import {
  DOC_PAGES,
  docMarkdown,
  findDoc,
  llmsFullTxt,
  llmsTxt,
  localizedMarkdown,
  pageLink,
  type DocPage,
  type DocUrls,
} from "./index";

const TEXT_HEADERS = { "Cache-Control": "public, max-age=300" };

function markdownResponse(text: string, type = "text/markdown"): Response {
  return new Response(text, {
    headers: { ...TEXT_HEADERS, "Content-Type": `${type}; charset=utf-8` },
  });
}

/** Error codes keep their own name as anchor (`errors#BUDGET_EXCEEDED`). */
function headingId(text: string): string {
  if (/^[A-Z][A-Z_]+$/.test(text)) return text;
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function renderer(urls: DocUrls): Marked {
  return new Marked({
    walkTokens(token) {
      if (token.type !== "link") return;
      // Links between pages (`errors.md#CODE`) open the HTML page here
      const href: unknown = token.href;
      if (typeof href === "string") token.href = pageLink(href, urls, "");
    },
    renderer: {
      heading({ tokens, depth, text }) {
        const inner = this.parser.parseInline(tokens);
        return `<h${depth} id="${escapeHtml(headingId(text))}">${inner}</h${depth}>\n`;
      },
    },
  });
}

const NAV = `<nav><a href="/">Modelfy MCP</a><a href="/docs">Docs</a><a href="/llms.txt">llms.txt</a></nav>`;

function pageHtml(page: DocPage, urls: DocUrls): Response {
  const markdown = localizedMarkdown(page, urls);
  const html = renderer(urls).parse(markdown, { async: false });
  return htmlPage(`${page.title} · Modelfy MCP`, `${NAV}\n${html}`);
}

function indexHtml(): Response {
  const items = DOC_PAGES.map(
    (page) =>
      `<li><a href="/docs/${page.slug}">${escapeHtml(page.title)}</a>: ${escapeHtml(page.description)}</li>`,
  ).join("\n");
  return htmlPage(
    "Docs · Modelfy MCP",
    `${NAV}
<h1>Modelfy MCP docs</h1>
<p>For people and agents. Each page is also Markdown (add <code>.md</code>), all of them are in <a href="/llms-full.txt">llms-full.txt</a>, and connected agents read them with the <code>get_docs</code> tool.</p>
<ul>
${items}
</ul>`,
  );
}

/**
 * GET /docs, /docs/<page>, /docs/<page>.md, /llms.txt and /llms-full.txt;
 * null for any other request.
 */
export function docsRoute(request: Request, urls: DocUrls): Response | null {
  if (request.method !== "GET") return null;
  const { pathname } = new URL(request.url);
  if (pathname === "/llms.txt") {
    return markdownResponse(llmsTxt(urls), "text/plain");
  }
  if (pathname === "/llms-full.txt") {
    return markdownResponse(llmsFullTxt(urls), "text/plain");
  }
  const acceptsMarkdown = (request.headers.get("Accept") ?? "").includes(
    "text/markdown",
  );
  if (pathname === "/docs" || pathname === "/docs/") {
    return negotiated(
      acceptsMarkdown ? markdownResponse(llmsTxt(urls)) : indexHtml(),
    );
  }
  const match = /^\/docs\/([a-z0-9-]+)(\.md)?$/.exec(pathname);
  if (match === null) return null;
  const [, slug = "", extension] = match;
  const page = findDoc(slug);
  if (page === null) return null;
  if (extension !== undefined) {
    return markdownResponse(docMarkdown(page, urls));
  }
  return negotiated(
    acceptsMarkdown
      ? markdownResponse(docMarkdown(page, urls))
      : pageHtml(page, urls),
  );
}

/** HTML or Markdown by Accept: caches must keep them apart. */
function negotiated(response: Response): Response {
  response.headers.set("Vary", "Accept");
  return response;
}
