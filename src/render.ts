// A small, fixed Markdown subset rendered to HTML for people opening a share link in a browser.
// Everything is escaped first, so file content can never add markup. Agents keep receiving the
// Markdown unchanged. Links are not rendered; the projection list at the top carries the only anchors.

const escapes: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => escapes[char]);
}

function readableTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const day = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date).replace(",", "");
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }).format(date);
  return `${day}, ${time} UTC`;
}

function inline(text: string): string {
  return escapeHtml(text)
    .split(/(`[^`]+`)/)
    .map((part) => {
      if (part.length > 1 && part.startsWith("`") && part.endsWith("`")) return `<code>${part.slice(1, -1)}</code>`;
      return part
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\b\d{4}-\d{2}-\d{2}T[\d:.]+Z\b/g, (iso) => readableTime(iso));
    })
    .join("");
}

export function renderMarkdown(markdown: string): string {
  const out: string[] = [];
  let list = false;
  let fence: string[] | null = null;
  const closeList = () => {
    if (list) out.push("</ul>");
    list = false;
  };
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) {
      if (fence) {
        out.push(`<pre><code>${escapeHtml(fence.join("\n"))}</code></pre>`);
        fence = null;
      } else {
        closeList();
        fence = [];
      }
      continue;
    }
    if (fence) {
      fence.push(line);
      continue;
    }
    const heading = /^(#{1,3}) (.*)$/.exec(line);
    const item = /^[-*] (.*)$/.exec(line);
    if (heading) {
      closeList();
      out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
    } else if (item) {
      if (!list) out.push("<ul>");
      list = true;
      out.push(`<li>${inline(item[1])}</li>`);
    } else if (line.trim() === "") {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  if (fence) out.push(`<pre><code>${escapeHtml(fence.join("\n"))}</code></pre>`);
  closeList();
  return out.join("\n");
}

export function renderSharePage(markdown: string, projectionLinks: Array<{ name: string; href: string }>): string {
  const links = projectionLinks.map((link) => `<a href="${escapeHtml(link.href)}">${escapeHtml(link.name)}</a>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>Agent File Optimizer handoff</title>
<link rel="icon" href="data:,">
<style>
:root { color-scheme: light dark; --bg:#f7f4ee; --ink:#1f2328; --muted:#4a5159; --edge:#857d6e; --code:#ebe6da; --accent:#33541e; }
@media (prefers-color-scheme: dark) { :root { --bg:#15171a; --ink:#f0efe9; --muted:#c4c8cf; --edge:#7a828c; --code:#23272c; --accent:#b9de8a; } }
body { margin:0; background:var(--bg); color:var(--ink); font:17px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif; }
main { max-width:680px; margin:0 auto; padding:32px max(20px, env(safe-area-inset-right)) 64px max(20px, env(safe-area-inset-left)); }
h1 { font-size:1.6rem; line-height:1.2; } h2 { font-size:1.15rem; margin-top:1.8em; }
code { background:var(--code); padding:.1em .35em; border-radius:4px; font-size:.92em; overflow-wrap:anywhere; }
pre { background:var(--code); padding:12px 14px; border-radius:8px; overflow-x:auto; } pre code { padding:0; }
nav { display:flex; flex-wrap:wrap; gap:8px; margin:0 0 8px; }
nav a { color:var(--accent); border:1px solid var(--edge); border-radius:10px; padding:8px 12px; min-height:24px; text-decoration:none; font-weight:600; }
nav a:focus-visible { outline:3px solid var(--ink); outline-offset:2px; }
.note { color:var(--muted); font-size:.9rem; }
</style>
</head>
<body>
<main>
<nav aria-label="Workspace files">${links}</nav>
<p class="note">This is the readable view. Agents fetching this link receive the same text as Markdown.</p>
${renderMarkdown(markdown)}
</main>
</body>
</html>
`;
}
