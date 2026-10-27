// Reads an EPUB the way the format states it: the package document (OPF) names the book, lists its parts,
// and fixes their reading order (the spine); the navigation document or NCX names the sections. Nothing is
// guessed that the book already says, so a book comes out in the order its author set, with its title,
// authors, language and contents. Chapters are XHTML and are read with the same reader as web pages.
import { unzipSync } from "fflate";
import { buildHtmlTree, readHtmlString, type HtmlNode } from "./html";
import { decodeMarkup } from "./markupencoding";
import { descendants, elements, first, parseXml, textOf, type XmlElement } from "./xml";

export interface EpubResult {
  text: string;
  jsonl: string[];
  warnings: string[];
}

const MAX_PARTS = 5000;
const MAX_PART_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 96 * 1024 * 1024;
const MAX_OUTPUT = 1_500_000;
const MAX_CONTENTS = 300;

const READABLE_PART = /\.(?:x?html?|xml|opf|ncx|svg)$/i;

function decodeUtf8(bytes: Uint8Array): string {
  return decodeMarkup(bytes).text;
}

function dirOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(0, slash + 1) : "";
}

/** Joins a package-relative href to a base folder, resolves "." and "..", drops any fragment, and decodes percent escapes. */
function resolve(base: string, href: string): { path: string; fragment: string } {
  const [rawPath, ...rest] = href.split("#");
  let decoded = rawPath;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    /* keep it as written */
  }
  const parts: string[] = [];
  for (const part of (decoded.startsWith("/") ? decoded.slice(1) : base + decoded).split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return { path: parts.join("/"), fragment: rest.join("#") };
}

interface ManifestItem {
  id: string;
  href: string;
  type: string;
  properties: string[];
}

function shiftHeadings(text: string, to: number): string {
  const lines = text.split("\n");
  let fenced = false;
  let delta: number | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith("```")) fenced = !fenced;
    if (fenced) continue;
    const heading = /^(#{1,6}) /.exec(lines[i]);
    if (!heading) continue;
    if (delta === null) delta = to - heading[1].length;
    const level = Math.min(6, Math.max(1, heading[1].length + delta));
    lines[i] = `${"#".repeat(level)} ${lines[i].slice(heading[0].length)}`;
  }
  return lines.join("\n");
}

function firstHeadingLevel(text: string): number | null {
  const match = /^(#{1,6}) /m.exec(text);
  return match ? match[1].length : null;
}

function svgText(bytes: Uint8Array): string {
  try {
    const root = parseXml(decodeUtf8(bytes));
    return descendants(root, "text").map((node) => textOf(node).replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
  } catch {
    return "";
  }
}

export function readEpub(bytes: Uint8Array): EpubResult {
  const warnings: string[] = [];
  let skipped = 0;
  let selected = 0;
  let totalBytes = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (file) => {
        if (file.name.endsWith("/")) return false;
        if (!READABLE_PART.test(file.name) && file.name !== "mimetype") return false;
        if (selected >= MAX_PARTS || file.originalSize > MAX_PART_BYTES || totalBytes + file.originalSize > MAX_TOTAL_BYTES) {
          skipped += 1;
          return false;
        }
        selected += 1;
        totalBytes += file.originalSize;
        return true;
      },
    });
  } catch {
    throw new Error("The EPUB could not be safely inspected.");
  }
  const lower = new Map<string, string>();
  for (const name of Object.keys(files)) lower.set(name.toLowerCase(), name);
  const get = (path: string): Uint8Array | undefined => files[path] ?? (lower.has(path.toLowerCase()) ? files[lower.get(path.toLowerCase())!] : undefined);

  if (skipped > 0) warnings.push(`${skipped} part(s) of the book were omitted by safety limits.`);

  // 1. Find the package document.
  let opfPath = "";
  const container = get("META-INF/container.xml");
  if (container) {
    const rootfile = descendants(parseXml(decodeUtf8(container)), "rootfile")[0];
    opfPath = rootfile?.attrs["full-path"] ?? "";
  }
  if (!opfPath || !get(opfPath)) opfPath = Object.keys(files).find((name) => name.toLowerCase().endsWith(".opf")) ?? "";
  if (!opfPath) throw new Error("The EPUB has no package document, so its reading order is unknown.");
  const opf = parseXml(decodeUtf8(get(opfPath)!));
  const pkg = first(opf, "package") ?? opf;
  const root = dirOf(opfPath);

  // 2. Encryption: font obfuscation is harmless; anything else means the text itself cannot be read.
  let protectedParts = 0;
  const encryption = get("META-INF/encryption.xml");
  if (encryption) {
    for (const data of descendants(parseXml(decodeUtf8(encryption)), "EncryptionMethod")) {
      const algorithm = data.attrs.Algorithm ?? "";
      if (algorithm !== "http://www.idpf.org/2008/embedding" && algorithm !== "http://ns.adobe.com/pdf/enc#RC") protectedParts += 1;
    }
  }

  // 3. What the package says about the book.
  const metadata = first(pkg, "metadata");
  const list = (name: string): string[] =>
    metadata
      ? elements(metadata, name)
          .map((node) => textOf(node).replace(/\s+/g, " ").trim())
          .filter(Boolean)
      : [];
  const title = list("title")[0] ?? "";
  const creators = list("creator");
  const facts: Array<[string, string]> = [];
  if (creators.length > 0) facts.push(["Author", creators.slice(0, 8).join(", ")]);
  const language = list("language")[0];
  if (language) facts.push(["Language", language]);
  const publisher = list("publisher")[0];
  if (publisher) facts.push(["Publisher", publisher]);
  const date = list("date")[0];
  if (date) facts.push(["Published", date]);
  const subjects = list("subject");
  if (subjects.length > 0) facts.push(["Subjects", subjects.slice(0, 12).join("; ")]);
  const description = list("description")[0];
  if (description) {
    const plainDescription = readHtmlString(description.includes("<") ? description : `<p>${description}</p>`, { includeFacts: false }).text.replace(/\s+/g, " ").trim();
    facts.push(["Description", plainDescription.length > 600 ? `${plainDescription.slice(0, 600)}…` : plainDescription]);
  }

  // 4. The manifest and the spine.
  const manifest = new Map<string, ManifestItem>();
  const manifestEl = first(pkg, "manifest");
  for (const item of manifestEl ? elements(manifestEl, "item") : []) {
    const id = item.attrs.id;
    const href = item.attrs.href;
    if (id && href) manifest.set(id, { id, href, type: (item.attrs["media-type"] ?? "").toLowerCase(), properties: (item.attrs.properties ?? "").split(/\s+/).filter(Boolean) });
  }
  const spineEl = first(pkg, "spine");
  const spine = spineEl ? elements(spineEl, "itemref").map((ref) => manifest.get(ref.attrs.idref ?? "")).filter((item): item is ManifestItem => item !== undefined) : [];
  if (spine.length === 0) throw new Error("The EPUB's package lists no reading order.");

  // 5. Section names: the navigation document, or the NCX.
  const labels = new Map<string, string>();
  const contents: Array<{ depth: number; label: string }> = [];
  const noteLabel = (path: string, label: string): void => {
    if (label && !labels.has(path)) labels.set(path, label);
  };
  const navItem = [...manifest.values()].find((item) => item.properties.includes("nav"));
  const ncxItem = (spineEl?.attrs.toc ? manifest.get(spineEl.attrs.toc) : undefined) ?? [...manifest.values()].find((item) => item.type === "application/x-dtbncx+xml");
  const navBytes = navItem ? get(resolve(root, navItem.href).path) : undefined;
  const ncxBytes = ncxItem ? get(resolve(root, ncxItem.href).path) : undefined;
  if (navItem && navBytes) {
    const base = dirOf(resolve(root, navItem.href).path);
    const tree = buildHtmlTree(decodeUtf8(navBytes), { xml: true });
    const walk = (node: HtmlNode, depth: number, inToc: boolean): void => {
      for (const child of node.children) {
        if (typeof child === "string") continue;
        const isToc = child.tag === "nav" && (child.attrs["epub:type"] ?? child.attrs.type ?? "").split(/\s+/).includes("toc");
        const inside = inToc || isToc;
        if (inside && child.tag === "a" && child.attrs.href) {
          const label = readHtmlString(`<p>${nodeSource(child)}</p>`, { includeFacts: false }).text.replace(/\s+/g, " ").trim();
          noteLabel(resolve(base, child.attrs.href).path, label);
          if (label) contents.push({ depth, label });
        }
        walk(child, inside && child.tag === "ol" ? depth + 1 : depth, inside);
      }
    };
    walk(tree, -1, false);
  } else if (ncxItem && ncxBytes) {
    const base = dirOf(resolve(root, ncxItem.href).path);
    const visit = (points: XmlElement[], depth: number): void => {
      for (const point of points) {
        const label = textOf(first(point, "navLabel") ?? point).replace(/\s+/g, " ").trim();
        const src = first(point, "content")?.attrs.src;
        if (src) noteLabel(resolve(base, src).path, label);
        if (label) contents.push({ depth, label });
        visit(elements(point, "navPoint"), depth + 1);
      }
    };
    const map = descendants(parseXml(decodeUtf8(ncxBytes)), "navMap")[0];
    if (map) visit(elements(map, "navPoint"), 0);
  }

  // 6. The chapters, in spine order.
  const sections: Array<{ title: string; href: string; text: string }> = [];
  let emptyParts = 0;
  let unreadable = 0;
  let used = 0;
  let stopped = 0;
  for (const item of spine) {
    const path = resolve(root, item.href).path;
    const data = get(path);
    if (!data) {
      unreadable += 1;
      continue;
    }
    let body = "";
    try {
      if (item.type === "image/svg+xml") body = svgText(data);
      else if (/html|xml/.test(item.type) || /\.x?html?$/i.test(path)) body = readHtmlString(decodeMarkup(data).text, { xml: !/\.html?$/i.test(path), includeFacts: false }).text;
      else continue;
    } catch {
      unreadable += 1;
      continue;
    }
    body = body.trim();
    if (!body) {
      emptyParts += 1;
      continue;
    }
    const label = labels.get(path) ?? "";
    const level = firstHeadingLevel(body);
    if (level !== null) body = shiftHeadings(body, 2);
    else if (label) body = `## ${label}\n\n${body}`;
    else body = `## Section ${sections.length + 1}\n\n${body}`;
    if (used + body.length > MAX_OUTPUT) {
      stopped += 1;
      continue;
    }
    used += body.length;
    sections.push({ title: label || (/^## (.+)$/m.exec(body)?.[1] ?? `Section ${sections.length + 1}`), href: item.href, text: body });
  }
  if (stopped > 0) warnings.push(`The book is longer than ${MAX_OUTPUT.toLocaleString("en-US")} characters. ${sections.length} of ${sections.length + stopped} sections were read; the last ${stopped} were not.`);
  if (unreadable > 0) warnings.push(`${unreadable} part(s) listed in the reading order could not be read.`);
  if (protectedParts > 0) warnings.push("Parts of this book are encrypted (DRM), so their text cannot be read.");
  if (sections.length === 0) {
    const pictures = spine.filter((item) => item.type.startsWith("image/")).length;
    throw new Error(
      protectedParts > 0
        ? "This book is encrypted (DRM), so its text cannot be read."
        : pictures > 0
          ? "The pages of this book are pictures, so there is no text to read. Reading them would need OCR."
          : "The EPUB has no readable text.",
    );
  }

  // 7. The result.
  const head: string[] = [];
  head.push(`# ${title || "Untitled book"}`);
  if (facts.length > 0) head.push(facts.map(([key, value]) => `${key}: ${value}`).join("\n"));
  const version = pkg.attrs.version;
  head.push(`Format: EPUB${version ? ` ${version}` : ""} · ${sections.length} readable section${sections.length === 1 ? "" : "s"}`);
  if (contents.length > 1) {
    const shown = contents.slice(0, MAX_CONTENTS).map((entry) => `${"  ".repeat(Math.max(0, entry.depth))}- ${entry.label}`);
    if (contents.length > MAX_CONTENTS) shown.push(`- (+${contents.length - MAX_CONTENTS} more)`);
    head.push(`## Contents\n\n${shown.join("\n")}`);
  }
  const text = [...head, ...sections.map((section) => section.text)].join("\n\n");
  const jsonl = sections.map((section, index) => JSON.stringify({ section: index + 1, title: section.title, href: section.href, text: section.text }));
  return { text, jsonl, warnings };
}

/** The text of an XHTML node as simple markup, for reading a link's label. */
function nodeSource(node: HtmlNode): string {
  return node.children.map((child) => (typeof child === "string" ? escapeText(child) : nodeSource(child))).join("");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}
