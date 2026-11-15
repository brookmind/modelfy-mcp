import { DOC_PAGES } from "./content";
import type { DocPage } from "./types";

export type { DocPage } from "./types";
export { DOC_PAGES } from "./content";

/** The URLs the Markdown sources are written with (production). */
const SOURCE_MCP_URL = "https://mcp.modelfy.ai";
const SOURCE_WEB_URL = "https://beta.modelfy.ai";

/** Where this deployment lives, so dev serves dev links. */
export interface DocUrls {
  publicUrl: string;
  webUrl: string;
}

export const DOC_SLUGS: readonly string[] = DOC_PAGES.map((page) => page.slug);

export function findDoc(slug: string): DocPage | null {
  return DOC_PAGES.find((page) => page.slug === slug) ?? null;
}

export function docUrl(slug: string, urls: DocUrls): string {
  return `${urls.publicUrl}/docs/${slug}`;
}

/** A page's Markdown with the production URLs pointed at this deployment. */
export function localizedMarkdown(page: DocPage, urls: DocUrls): string {
  return page.markdown
    .replaceAll(SOURCE_MCP_URL, urls.publicUrl)
    .replaceAll(SOURCE_WEB_URL, urls.webUrl);
}

/** A link between pages (`errors.md#CODE`) as a URL of this deployment. */
export function pageLink(
  href: string,
  urls: DocUrls,
  extension: "" | ".md",
): string {
  const match = /^([a-z0-9-]+)\.md(#.*)?$/.exec(href);
  if (match === null) return href;
  const [, slug = "", anchor = ""] = match;
  if (findDoc(slug) === null) return href;
  return `${docUrl(slug, urls)}${extension}${anchor}`;
}

/** A page as Markdown for agents: this deployment's URLs, absolute links. */
export function docMarkdown(page: DocPage, urls: DocUrls): string {
  return localizedMarkdown(page, urls).replace(
    /\]\(([^)\s]+)\)/g,
    (_whole, href: string) => `](${pageLink(href, urls, ".md")})`,
  );
}

/** /llms.txt (https://llmstxt.org): what this is and where each page is. */
export function llmsTxt(urls: DocUrls): string {
  const pages = DOC_PAGES.map(
    (page) =>
      `- [${page.title}](${docUrl(page.slug, urls)}.md): ${page.description}`,
  ).join("\n");
  return `# Modelfy MCP

> An MCP server that lets any AI agent create product photos with Modelfy: a product on a model in a real place, or on a studio background. Endpoint: ${urls.publicUrl}/mcp (Streamable HTTP, OAuth 2.1 or Bearer API key). Every launch is priced first and needs the person's yes or a key's budget.

Connected agents can also read these pages with the get_docs tool, or as MCP resources at modelfy://docs/<page>.

## Docs

${pages}

## Optional

- [Everything in one file](${urls.publicUrl}/llms-full.txt): all the pages above
- [Source code](https://github.com/brookmind/modelfy-mcp): the server, the Claude Code plugin and these docs
`;
}

/** /llms-full.txt: every page, in order. */
export function llmsFullTxt(urls: DocUrls): string {
  return DOC_PAGES.map((page) => docMarkdown(page, urls)).join("\n---\n\n");
}
