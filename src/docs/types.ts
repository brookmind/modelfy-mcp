/** One documentation page, compiled from docs/<slug>.md. */
export interface DocPage {
  slug: string;
  title: string;
  description: string;
  markdown: string;
}
