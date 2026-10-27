// Static checks for the public site: required pages, metadata, no third-party scripts, and no tracking.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "site");
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const indexPath = join(root, "index.html");
expect(existsSync(indexPath), "site/index.html is missing");
const html = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : "";

expect(/<html lang="[a-z-]+"/i.test(html), "html element needs a lang attribute");
expect(/<title>[^<]{10,}<\/title>/.test(html), "page needs a descriptive title");
expect(/<meta name="description" content="[^"]{40,}"/.test(html), "page needs a meta description of at least 40 characters");
expect(/<meta property="og:title"/.test(html) && /<meta property="og:description"/.test(html), "page needs Open Graph title and description");
expect(/<meta name="viewport" content="width=device-width/.test(html), "page needs a viewport meta tag");
// Structured data is inert JSON, not executable. Any other script is refused.
const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)];
expect(scripts.every(([, attributes]) => /type="application\/ld\+json"/.test(attributes)), "the site must not include scripts (no analytics, trackers, or widgets); only JSON-LD data blocks are allowed");
expect(!/<iframe[\s>]/i.test(html), "the site must not embed iframes");
expect(!/(googletagmanager|analytics|doubleclick|facebook\.net|hotjar|mailchimp|newsletter)/i.test(html), "the site must not reference tracking or newsletter services");
expect(!/(testimonial|waitlist|\$\d+\s*\/\s*month|users? (?:already|trust))/i.test(html), "the site must not contain testimonials, waitlists, pricing, or user counts");
// The one allowed third-party link is Cloudflare's deploy page, which clones this repository into the visitor's own account.
expect(!/href="https?:\/\/(?!github\.com\/rmichaelthomas\/|rmichaelthomas\.github\.io\/agent-file-optimizer\/|rmichaelthomas\.com|deploy\.workers\.cloudflare\.com\/\?url=https:\/\/github\.com\/rmichaelthomas\/agent-file-optimizer")/.test(html), "outbound links should point only to the project repository, the author's site, or the Cloudflare deploy link for this repository");
expect(/Built by <a href="https:\/\/rmichaelthomas\.com">R\. Michael Thomas<\/a>/.test(html), "the page must credit the builder with the agreed attribution line");
expect(!/\bany file\b/i.test(html), "do not claim 'any file'");
expect(!/malware[- ]scanned|zero[- ]retention guaranteed|private repos? supported/i.test(html), "do not make unsupported safety or support claims");

const hasH1 = (html.match(/<h1[\s>]/g) || []).length === 1;
expect(hasH1, "the page needs exactly one h1");
expect(/<meta http-equiv="Content-Security-Policy"/.test(html), "the page needs a Content-Security-Policy meta tag (GitHub Pages cannot set headers)");

// Discovery: canonical address, social images, structured data, and the files crawlers and answer engines read.
const base = "https://rmichaelthomas.github.io/agent-file-optimizer/";
expect(html.includes(`<link rel="canonical" href="${base}">`), "page needs a canonical link to the published address");
expect(html.includes(`<meta property="og:url" content="${base}">`), "og:url must match the canonical address");
expect(html.includes(`<meta property="og:image" content="${base}og.png">`) && html.includes(`<meta name="twitter:image" content="${base}og.png">`), "og:image and twitter:image must be the absolute address of og.png");
expect(/<meta property="og:image:alt" content="[^"]{20,}"/.test(html) && /<meta name="twitter:image:alt" content="[^"]{10,}"/.test(html), "social images need alt text");
expect(/<meta name="twitter:card" content="summary_large_image">/.test(html), "use the large-image Twitter card");
const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || "";
expect(title.length <= 65, `title is ${title.length} characters; keep it at 65 or fewer so it is not cut off in results`);
const description = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || "";
expect(description.length >= 70 && description.length <= 170, `meta description is ${description.length} characters; keep it between 70 and 170`);
for (const file of ["og.png", "favicon.svg", "robots.txt", "sitemap.xml", "llms.txt"]) expect(existsSync(join(root, file)), `site/${file} is missing`);
if (existsSync(join(root, "og.png"))) {
  const png = readFileSync(join(root, "og.png"));
  expect(png.readUInt32BE(16) === 1200 && png.readUInt32BE(20) === 630, "og.png must be 1200x630");
  expect(png.length < 600 * 1024, "og.png should stay under 600 KB so link previews load");
}
if (existsSync(join(root, "robots.txt"))) expect(readFileSync(join(root, "robots.txt"), "utf8").includes(`Sitemap: ${base}sitemap.xml`), "robots.txt must point to the sitemap");
if (existsSync(join(root, "sitemap.xml"))) expect(readFileSync(join(root, "sitemap.xml"), "utf8").includes(`<loc>${base}</loc>`), "sitemap.xml must list the site address");
if (existsSync(join(root, "llms.txt"))) {
  const llms = readFileSync(join(root, "llms.txt"), "utf8");
  expect(llms.startsWith("# Agent File Optimizer"), "llms.txt must start with the project name as a heading");
  expect(!/\bany file\b|zero[- ]retention|malware[- ]scanned|private repos? supported/i.test(llms), "llms.txt must not make the claims the site avoids");
}
// Structured data must parse, and the FAQ markup must say what the visible page says.
const blocks = scripts.map(([, , body]) => { try { return JSON.parse(body); } catch { failures.push("a JSON-LD block does not parse"); return null; } }).filter(Boolean);
const faq = blocks.find((block) => block["@type"] === "FAQPage");
expect(blocks.some((block) => [].concat(block["@type"]).includes("SoftwareApplication")), "needs SoftwareApplication structured data");
expect(Boolean(faq), "needs FAQPage structured data");
const stripTags = (text) => text.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
for (const entry of faq ? faq.mainEntity : []) {
  const visible = html.includes(`<h3>${entry.name}</h3>`) && stripTags(html.split(`<h3>${entry.name}</h3>`)[1].split("</p>")[0]) === entry.acceptedAnswer.text;
  expect(visible, `FAQ "${entry.name}" in structured data must match the visible question and answer`);
}

if (failures.length) {
  console.error(failures.map((f) => `FAIL ${f}`).join("\n"));
  process.exit(1);
}
console.log("site checks passed");
