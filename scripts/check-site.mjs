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
expect(!/<script[\s>]/i.test(html), "the site must not include scripts (no analytics, trackers, or widgets)");
expect(!/<iframe[\s>]/i.test(html), "the site must not embed iframes");
expect(!/(googletagmanager|analytics|doubleclick|facebook\.net|hotjar|mailchimp|newsletter)/i.test(html), "the site must not reference tracking or newsletter services");
expect(!/(testimonial|waitlist|\$\d+\s*\/\s*month|users? (?:already|trust))/i.test(html), "the site must not contain testimonials, waitlists, pricing, or user counts");
expect(!/href="https?:\/\/(?!github\.com\/rmichaelthomas\/|rmichaelthomas\.com)/.test(html), "outbound links should point only to the project repository or the author's site");
expect(/Built by <a href="https:\/\/rmichaelthomas\.com">R\. Michael Thomas<\/a>/.test(html), "the page must credit the builder with the agreed attribution line");
expect(!/\bany file\b/i.test(html), "do not claim 'any file'");
expect(!/malware[- ]scanned|zero[- ]retention guaranteed|private repos? supported/i.test(html), "do not make unsupported safety or support claims");

const hasH1 = (html.match(/<h1[\s>]/g) || []).length === 1;
expect(hasH1, "the page needs exactly one h1");
expect(/<meta http-equiv="Content-Security-Policy"/.test(html), "the page needs a Content-Security-Policy meta tag (GitHub Pages cannot set headers)");

if (failures.length) {
  console.error(failures.map((f) => `FAIL ${f}`).join("\n"));
  process.exit(1);
}
console.log("site checks passed");
