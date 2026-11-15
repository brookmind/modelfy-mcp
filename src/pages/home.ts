function escape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** GET /: what this is, the URL to add, and the three ways to get a key. */
export function homePage(publicUrl: string): Response {
  const mcp = escape(`${publicUrl}/mcp`);
  const base = escape(publicUrl);
  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Modelfy MCP</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #000; color: #fff; font: 16px/1.6 system-ui, sans-serif; }
  main { max-width: 44rem; margin: 0 auto; padding: 4rem 1.25rem; }
  h1 { font-weight: 500; font-size: 2.5rem; margin: 0 0 .5rem; }
  h2 { font-weight: 500; margin-top: 2.5rem; }
  p, li { color: #c8c8c8; }
  code, pre { font-family: ui-monospace, monospace; background: #111; border: 1px solid #222; border-radius: 8px; }
  code { padding: .1rem .35rem; }
  pre { padding: 1rem; overflow-x: auto; color: #fff; }
</style>
</head>
<body>
<main>
<h1>Modelfy MCP</h1>
<p>Let any AI agent create product photos with Modelfy: Claude, ChatGPT, Codex, Cursor, or your own.</p>

<h2>Add it</h2>
<pre>${mcp}</pre>
<p>Chat assistants (claude.ai, Claude Desktop, ChatGPT) sign in with your Modelfy account once. Coding agents and bots can use an API key in the <code>Authorization: Bearer</code> header.</p>

<h2>Get a key</h2>
<ul>
<li><strong>Try it now, no account:</strong> <code>curl -X POST ${base}/sandbox/keys</code> gives a free sandbox key. Nothing is spent; photos are samples.</li>
<li><strong>Device login:</strong> <code>POST ${base}/device/code</code>, open the link it returns, approve, then poll <code>POST ${base}/device/token</code>. The key comes to your agent; nobody copies it.</li>
<li><strong>By hand:</strong> create a key in your Modelfy account and paste it.</li>
</ul>

<h2>Spending</h2>
<p>Every session is planned first with its exact price (<code>plan_photos</code>). In a chat the person confirms it; a live API key spends only within the credit budget its owner set.</p>
</main>
</body>
</html>`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
