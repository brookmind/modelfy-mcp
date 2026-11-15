import { escapeHtml, htmlPage } from "./layout";

/** GET /: what this is, the URL to add, and where the docs are. */
export function homePage(publicUrl: string): Response {
  const mcp = escapeHtml(`${publicUrl}/mcp`);
  const base = escapeHtml(publicUrl);
  return htmlPage(
    "Modelfy MCP",
    `<h1>Modelfy MCP</h1>
<p>Let any AI agent create product photos with Modelfy: Claude, ChatGPT, Codex, Cursor, or your own.</p>

<h2>Add it</h2>
<pre>${mcp}</pre>
<p>In Claude Code:</p>
<pre>claude mcp add --transport http --scope user modelfy ${mcp}</pre>
<p>Chat assistants (claude.ai, Claude Desktop, ChatGPT) sign in with your Modelfy account once. Coding agents and bots can use an API key in the <code>Authorization: Bearer</code> header. Every client, step by step: <a href="/docs/connect">Connect your agent</a>.</p>

<h2>Get a key</h2>
<ul>
<li><strong>Try it now, no account:</strong> <code>curl -X POST ${base}/sandbox/keys</code> gives a free sandbox key. Nothing is spent; photos are samples.</li>
<li><strong>Device login:</strong> <code>POST ${base}/device/code</code>, open the link it returns, approve, then poll <code>POST ${base}/device/token</code>. The key comes to your agent; nobody copies it.</li>
<li><strong>By hand:</strong> create a key in your Modelfy account and paste it.</li>
</ul>

<h2>Spending</h2>
<p>Every session is planned first with its exact price (<code>plan_photos</code>). In a chat the person confirms it; a live API key spends only within the credit budget its owner set.</p>

<h2>Docs</h2>
<p><a href="/docs">All pages</a> · <a href="/llms.txt">llms.txt</a> · <a href="/llms-full.txt">llms-full.txt</a> · connected agents call <code>get_docs</code>.</p>`,
  );
}
