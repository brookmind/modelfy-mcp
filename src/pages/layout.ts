export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const STYLE = `
  :root { color-scheme: dark; }
  body { margin: 0; background: #000; color: #fff; font: 16px/1.6 system-ui, sans-serif; }
  main { max-width: 46rem; margin: 0 auto; padding: 4rem 1.25rem; }
  nav { font-size: .9rem; margin-bottom: 2rem; }
  nav a { margin-right: 1rem; }
  h1 { font-weight: 500; font-size: 2.5rem; margin: 0 0 .5rem; line-height: 1.2; }
  h2 { font-weight: 500; margin-top: 2.5rem; }
  h3 { font-weight: 500; margin-top: 2rem; }
  p, li, td { color: #c8c8c8; }
  a { color: #fff; }
  code, pre { font-family: ui-monospace, monospace; background: #111; border: 1px solid #222; border-radius: 8px; }
  code { padding: .1rem .35rem; font-size: .9em; }
  pre { padding: 1rem; overflow-x: auto; color: #fff; }
  pre code { border: 0; padding: 0; background: none; }
  table { border-collapse: collapse; width: 100%; display: block; overflow-x: auto; }
  th, td { text-align: left; padding: .4rem .6rem; border-bottom: 1px solid #222; vertical-align: top; }
  blockquote { margin: 0; padding-left: 1rem; border-left: 2px solid #333; }
`;

/**
 * A page of this server: the shared look, then the body as given. Without a
 * `status` it is a public page that caches may keep; with one it answers a
 * single request (a sign-in step, a sandbox page) and is not cached.
 */
export function htmlPage(
  title: string,
  body: string,
  status?: number,
): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;
  return new Response(html, {
    status: status ?? 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...(status === undefined
        ? { "Cache-Control": "public, max-age=300" }
        : {}),
    },
  });
}
