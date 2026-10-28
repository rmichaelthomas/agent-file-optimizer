// Reads HTML (and the XHTML chapters of an EPUB) into compact Markdown for an agent.
//
// What the page states beats what is guessed: the title, language, canonical address, description,
// author and dates come from the markup and JSON-LD the page declares, and only those that exist are
// listed. The body is read as structure: headings, paragraphs, lists, tables, quotations, code, links and
// image descriptions. Hidden content, scripts and styles are left out. A page's own <main> is read first,
// and the rest of the page (navigation, footers) follows, with link-only regions collapsed to one line.
//
// This is a static read: scripts do not run, so a page that builds itself in the browser comes out
// nearly empty, and the result says so.
import { tokenizeHtml } from "./htmltokens";
import { charsetOf, decodeMarkup } from "./markupencoding";

export interface HtmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: Array<HtmlNode | string>;
}

export interface HtmlRead {
  text: string;
  warnings: string[];
  /** What the page itself declares, in the order it is printed. */
  facts: Array<[string, string]>;
  encoding?: string;
}

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr", "keygen", "command"]);
const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const CLOSES_P = new Set(["address", "article", "aside", "blockquote", "center", "details", "dialog", "dir", "div", "dl", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "main", "menu", "nav", "ol", "p", "pre", "search", "section", "summary", "table", "ul", "li", "dd", "dt"]);
const P_SCOPE = new Set(["applet", "caption", "html", "table", "td", "th", "marquee", "object", "template", "button"]);
const HARD_EDGES = new Set(["td", "th", "caption", "template", "object", "applet", "marquee"]);
const TABLE_PARTS = new Set(["table", "tbody", "thead", "tfoot", "tr", "td", "th", "caption"]);
const SKIPPED = new Set(["script", "style", "template", "noscript", "head", "title", "meta", "link", "base", "svg", "canvas", "iframe", "object", "embed", "select", "datalist", "map", "audio", "video", "source", "track", "input", "textarea", "button", "dialog"]);
const BLOCKS = new Set(["address", "article", "aside", "blockquote", "body", "caption", "center", "dd", "details", "dir", "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form", "header", "hgroup", "hr", "html", "legend", "li", "main", "menu", "nav", "ol", "p", "pre", "search", "section", "summary", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul", "h1", "h2", "h3", "h4", "h5", "h6"]);

const EMBEDS = new Set(["iframe", "frame", "embed", "object", "audio", "video", "svg"]);

const MAX_ELEMENTS = 1_500_000;
const MAX_DEPTH = 512;
const MAX_OUTPUT = 1_500_000;
const MAX_TABLE_ROWS = 1000;
const MAX_TABLE_COLUMNS = 60;
const MAX_NAV_ITEMS = 40;

export interface BuildOptions {
  /** Tag syntax of XML: "/>" closes any element. */
  xml?: boolean;
}

/** Builds a light tree: elements nest, a few start tags close the elements they cannot sit inside, and an end tag closes through the nearest open element of its name. */
export function buildHtmlTree(source: string, options: BuildOptions = {}): HtmlNode {
  const root: HtmlNode = { tag: "#root", attrs: {}, children: [] };
  const stack: HtmlNode[] = [root];
  let elements = 0;
  let foreign = 0;
  const top = (): HtmlNode => stack[stack.length - 1];
  const closeThrough = (names: Set<string>, boundaries: Set<string>): void => {
    for (let k = stack.length - 1; k > 0; k -= 1) {
      const tag = stack[k].tag;
      if (names.has(tag)) {
        stack.length = k;
        return;
      }
      if (boundaries.has(tag)) return;
    }
  };
  const pop = (node: HtmlNode): void => {
    if (node.tag === "svg" || node.tag === "math") foreign = Math.max(0, foreign - 1);
  };
  const popTo = (length: number): void => {
    for (let k = stack.length - 1; k >= length; k -= 1) pop(stack[k]);
    stack.length = length;
  };

  tokenizeHtml(
    source,
    (token) => {
      if (token.type === "text") {
        const parent = top();
        const last = parent.children[parent.children.length - 1];
        if (typeof last === "string") parent.children[parent.children.length - 1] = last + token.data;
        else parent.children.push(token.data);
      } else if (token.type === "start") {
        const name = options.xml ? token.name.slice(token.name.indexOf(":") + 1) : token.name;
        if (!options.xml && foreign === 0) {
          if (CLOSES_P.has(name)) {
            for (let k = stack.length - 1; k > 0; k -= 1) {
              if (stack[k].tag === "p") {
                popTo(k);
                break;
              }
              if (P_SCOPE.has(stack[k].tag)) break;
            }
          }
          if (HEADINGS.has(name) && HEADINGS.has(top().tag)) popTo(stack.length - 1);
          if (name === "li") closeThrough(new Set(["li"]), new Set(["ul", "ol", "menu", "table", "td", "th", "template", "dl", "html", "body"]));
          else if (name === "dd" || name === "dt") closeThrough(new Set(["dd", "dt"]), new Set(["dl", "table", "td", "th", "template", "html", "body"]));
          else if (name === "tr") closeThrough(new Set(["tr"]), new Set(["table", "template", "html", "body"]));
          else if (name === "td" || name === "th") closeThrough(new Set(["td", "th"]), new Set(["tr", "table", "template", "html", "body"]));
          else if (name === "tbody" || name === "thead" || name === "tfoot") closeThrough(new Set(["tbody", "thead", "tfoot", "tr"]), new Set(["table", "template", "html", "body"]));
          else if (name === "option") closeThrough(new Set(["option"]), new Set(["select", "datalist", "optgroup"]));
          else if (name === "optgroup") closeThrough(new Set(["optgroup"]), new Set(["select"]));
        }
        elements += 1;
        if (elements > MAX_ELEMENTS) throw new Error("The page has too many elements to read safely.");
        const attrs: Record<string, string> = {};
        for (const [key, value] of token.attrs) attrs[key] = value;
        const node: HtmlNode = { tag: name, attrs, children: [] };
        top().children.push(node);
        const closed = VOID.has(name) || ((options.xml || foreign > 0) && token.selfClosing);
        if (!closed && stack.length < MAX_DEPTH) {
          stack.push(node);
          if (name === "svg" || name === "math") foreign += 1;
        }
      } else if (token.type === "end") {
        const name = options.xml ? token.name.slice(token.name.indexOf(":") + 1) : token.name;
        if (name === "br" || VOID.has(name)) return;
        for (let k = stack.length - 1; k > 0; k -= 1) {
          if (stack[k].tag === name) {
            popTo(k);
            return;
          }
          // An end tag does not reach out of a table cell, a caption, an object, or a template.
          if (!options.xml && HARD_EDGES.has(stack[k].tag) && !TABLE_PARTS.has(name)) return;
        }
      }
    },
    { cdata: () => foreign > 0 || options.xml === true, isForeign: () => foreign > 0, xml: options.xml },
  );
  return root;
}

// ---------------------------------------------------------------------------------------------------
// Reading

const INVISIBLE = /[​‌‍⁠﻿­]/g;
const SPACES = /[ \t\n\f\r ]+/g;

function attr(node: HtmlNode, name: string): string | undefined {
  return node.attrs[name];
}

/** Roles that make an element a control of the page's interface (a player's "mute", a tab's label), not part of what it says. */
const CONTROL_ROLES = new Set(["button", "switch", "slider", "spinbutton", "scrollbar", "menuitem", "menuitemcheckbox", "menuitemradio", "tab"]);

function isHidden(node: HtmlNode): boolean {
  if (node.attrs.role !== undefined && CONTROL_ROLES.has(node.attrs.role)) return true;
  const hidden = node.attrs.hidden;
  if (hidden !== undefined && hidden !== "until-found") return true;
  if (node.attrs["aria-hidden"] === "true") return true;
  const style = node.attrs.style;
  if (style && /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i.test(style)) return true;
  return node.tag === "input" && node.attrs.type?.toLowerCase() === "hidden";
}

function hasBlock(node: HtmlNode, memo: Map<HtmlNode, boolean>): boolean {
  const known = memo.get(node);
  if (known !== undefined) return known;
  let found = false;
  for (const child of node.children) {
    if (typeof child === "string") continue;
    if (BLOCKS.has(child.tag) || hasBlock(child, memo)) {
      found = true;
      break;
    }
  }
  memo.set(node, found);
  return found;
}

function plain(node: HtmlNode | string): string {
  if (typeof node === "string") return node;
  if (SKIPPED.has(node.tag) || isHidden(node)) return "";
  if (node.tag === "br") return " ";
  let out = "";
  for (const child of node.children) out += plain(child);
  return BLOCKS.has(node.tag) ? ` ${out} ` : out;
}

const clean = (text: string): string => text.replace(INVISIBLE, "").replace(SPACES, " ").trim();

interface Context {
  /** The page's own address, when it states one. Links to the same origin are written without it. */
  origin: string;
  warnings: Set<string>;
  skip: Set<HtmlNode>;
  memo: Map<HtmlNode, boolean>;
  budget: { left: number };
}

/** Adds source text, where every run of white space (a newline too) is one space. */
function appendText(buffer: string, text: string): string {
  let value = text.replace(INVISIBLE, "").replace(SPACES, " ");
  if (value.startsWith(" ") && (buffer.endsWith(" ") || buffer.endsWith("\n"))) value = value.slice(1);
  return buffer + value;
}

/** Adds the output of an inline element, where a newline is a line break the page asked for. */
function appendPiece(buffer: string, piece: string): string {
  let value = piece.replace(/[ \t\f\r\u00a0]+/g, " ");
  if (value.startsWith("\n")) buffer = buffer.replace(/ +$/, "");
  if (value.startsWith(" ") && (buffer.endsWith(" ") || buffer.endsWith("\n"))) value = value.slice(1);
  return buffer + value;
}

function wrap(mark: string, inner: string): string {
  const trimmed = inner.trim();
  if (!trimmed) return inner;
  const lead = inner.slice(0, inner.length - inner.trimStart().length);
  const tail = inner.slice(inner.trimEnd().length);
  return `${lead}${mark}${trimmed}${mark}${tail}`;
}

function linkTarget(href: string | undefined, ctx: Context): string | null {
  if (!href) return null;
  let value = href.trim();
  if (!value || value.startsWith("#") || /^(?:javascript|data|vbscript):/i.test(value)) return null;
  if (ctx.origin && value.startsWith(`${ctx.origin}/`)) value = value.slice(ctx.origin.length);
  return value.length > 400 ? value.slice(0, 400) : value;
}

/** A formula as plain text: the page's own text alternative when it has one, otherwise the symbols in reading order. */
function mathText(math: HtmlNode): string {
  // Some exporters write a placeholder where the text alternative should be. A placeholder is not a statement.
  const alt = clean(math.attrs.alttext ?? "");
  if (alt && !/^(?:alternative text.*|not available|no alt.*|math|equation|formula|image|mathml)$/i.test(alt)) return alt;
  const tex = findAll(math, (node) => node.tag === "annotation" && /tex/i.test(node.attrs.encoding ?? ""), [], 1)[0];
  if (tex) return clean(plainRaw(tex));
  const parts = (node: HtmlNode): HtmlNode[] => node.children.filter((child): child is HtmlNode => typeof child !== "string");
  const tight = (text: string): string => (/^[\w.]+$/.test(text) ? text : `(${text})`);
  const walk = (node: HtmlNode | string): string => {
    if (typeof node === "string") return node.replace(SPACES, " ");
    const kids = parts(node);
    switch (node.tag) {
      case "mi":
      case "mn":
      case "mo":
      case "mtext":
      case "ms":
        return clean(plainRaw(node));
      case "mspace":
        return " ";
      case "msup":
        return kids.length >= 2 ? `${walk(kids[0])}^${tight(walk(kids[1]))}` : walk(kids[0]);
      case "msub":
        return kids.length >= 2 ? `${walk(kids[0])}_${tight(walk(kids[1]))}` : walk(kids[0]);
      case "msubsup":
        return kids.length >= 3 ? `${walk(kids[0])}_${tight(walk(kids[1]))}^${tight(walk(kids[2]))}` : kids.map(walk).join("");
      case "mfrac":
        return kids.length >= 2 ? `${tight(walk(kids[0]))}/${tight(walk(kids[1]))}` : kids.map(walk).join("");
      case "msqrt":
        return `√(${kids.map(walk).join("")})`;
      case "mroot":
        return kids.length >= 2 ? `root(${walk(kids[1])}, ${walk(kids[0])})` : kids.map(walk).join("");
      case "mtd":
      case "mth":
        return kids.map(walk).join("").trim();
      case "mtr":
        return kids.map(walk).join(" ");
      case "mtable":
        return kids.map(walk).join("; ");
      case "semantics":
        return kids.length > 0 ? walk(kids[0]) : "";
      case "annotation":
      case "annotation-xml":
        return "";
      default:
        return kids.map(walk).join("");
    }
  };
  return walk(math).replace(/\s+/g, " ").trim();
}

function inlineElement(node: HtmlNode, ctx: Context): string {
  const tag = node.tag;
  if (tag === "br") return "\n";
  if (tag === "wbr") return "";
  if (tag === "img") {
    const alt = clean(attr(node, "alt") ?? "");
    return alt ? `[image: ${alt}]` : "";
  }
  if (tag === "math") return mathText(node);
  if (tag === "ruby") {
    let out = "";
    for (const child of node.children) {
      if (typeof child === "string") out += child;
      else if (child.tag === "rt") out += `(${clean(plain(child))})`;
      else if (child.tag !== "rp") out += plain(child);
    }
    return out;
  }
  const inner = inlineChildren(node.children, ctx);
  switch (tag) {
    case "a": {
      const text = clean(inner);
      const target = linkTarget(attr(node, "href"), ctx);
      if (!text) return "";
      if (!target) return inner;
      // Balanced brackets are fine inside link text (an image label is one); only a stray one needs a backslash.
      const balanced = (text.match(/\[/g)?.length ?? 0) === (text.match(/\]/g)?.length ?? 0);
      return text === target && /^https?:\/\//i.test(target) ? `<${target}>` : `[${balanced ? text : text.replace(/([[\]])/g, "\\$1")}](${target})`;
    }
    case "strong":
    case "b":
      return wrap("**", inner);
    case "em":
    case "i":
    case "cite":
    case "dfn":
      return wrap("*", inner);
    case "code":
    case "kbd":
    case "samp":
    case "tt":
    case "var": {
      const text = inner.replace(/\n/g, " ").trim();
      return text ? `\`${text.replace(/`/g, "'")}\`` : "";
    }
    case "del":
    case "s":
    case "strike":
      return wrap("~~", inner);
    case "sup":
    case "sub": {
      const text = clean(inner);
      if (!text) return "";
      const mark = tag === "sup" ? "^" : "_";
      return /^[\w+\-−]+$/.test(text) ? `${mark}${text}` : `${mark}(${text})`;
    }
    case "q":
      return `"${inner.trim()}"`;
    case "time":
      return clean(inner) ? inner : (attr(node, "datetime") ?? "");
    case "data":
      return clean(inner) ? inner : (attr(node, "value") ?? "");
    case "meter":
    case "progress": {
      if (clean(inner)) return inner;
      const value = attr(node, "value");
      if (value === undefined) return "";
      const max = attr(node, "max") ?? (tag === "progress" ? "1" : undefined);
      return `[${tag}: ${value}${max ? ` of ${max}` : ""}]`;
    }
    default:
      return inner;
  }
}

/** What a page puts somewhere else (another page, a video, a graphic) cannot be read here, so it is named instead of dropped. */
function embedLabel(node: HtmlNode): string {
  const address = (value: string | undefined): string => {
    const text = (value ?? "").trim();
    return text && !/^(?:about:|javascript:|data:)/i.test(text) ? (text.length > 300 ? text.slice(0, 300) : text) : "";
  };
  const label = clean(node.attrs.title ?? node.attrs["aria-label"] ?? "");
  switch (node.tag) {
    case "iframe":
    case "frame":
    case "embed": {
      const src = address(node.attrs.src);
      return src ? `[embedded page${label ? ` "${label}"` : ""}: ${src}]` : "";
    }
    case "object": {
      const data = address(node.attrs.data);
      return data ? `[embedded object${label ? ` "${label}"` : ""}: ${data}]` : "";
    }
    case "audio":
    case "video": {
      const source = node.children.find((child): child is HtmlNode => typeof child !== "string" && child.tag === "source");
      const src = address(node.attrs.src ?? source?.attrs.src);
      return `[${node.tag}${label ? ` "${label}"` : ""}${src ? `: ${src}` : ""}]`;
    }
    case "svg": {
      const title = node.children.find((child): child is HtmlNode => typeof child !== "string" && child.tag === "title");
      const text = label || (title ? clean(plainRaw(title)) : "");
      return text ? `[graphic: ${text}]` : "";
    }
    default:
      return "";
  }
}

function inlineChildren(children: Array<HtmlNode | string>, ctx: Context): string {
  let buffer = "";
  for (const child of children) {
    if (typeof child === "string") {
      buffer = appendText(buffer, child);
      continue;
    }
    if (isHidden(child) || ctx.skip.has(child)) continue;
    if (EMBEDS.has(child.tag)) {
      const label = embedLabel(child);
      if (label) buffer = appendPiece(buffer, ` ${label} `);
      continue;
    }
    if (SKIPPED.has(child.tag)) continue;
    // A block inside a heading, a link or a cell still ends a word, so "<div>Cooking</div><div>Recipes</div>" reads as two words.
    const piece = BLOCKS.has(child.tag) ? ` ${inlineChildren(child.children, ctx)} ` : inlineElement(child, ctx);
    if (piece) buffer = appendPiece(buffer, piece);
  }
  return buffer;
}

function paragraph(buffer: string): string {
  return buffer
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function linkDensity(node: HtmlNode): number {
  let total = 0;
  let linked = 0;
  const walk = (current: HtmlNode | string, inLink: boolean): void => {
    if (typeof current === "string") {
      const length = clean(current).length;
      total += length;
      if (inLink) linked += length;
      return;
    }
    if (SKIPPED.has(current.tag) || isHidden(current)) return;
    for (const child of current.children) walk(child, inLink || current.tag === "a");
  };
  walk(node, false);
  return total === 0 ? 0 : linked / total;
}

function compactLinks(node: HtmlNode): string {
  const labels: string[] = [];
  const seen = new Set<string>();
  const walk = (current: HtmlNode | string): void => {
    if (typeof current === "string" || SKIPPED.has(current.tag) || isHidden(current)) return;
    if (current.tag === "a") {
      const label = clean(plain(current));
      if (label && !seen.has(label)) {
        seen.add(label);
        labels.push(label);
      }
      return;
    }
    for (const child of current.children) walk(child);
  };
  walk(node);
  if (labels.length === 0) return "";
  const shown = labels.slice(0, MAX_NAV_ITEMS).join(" · ");
  return labels.length > MAX_NAV_ITEMS ? `${shown} · (+${labels.length - MAX_NAV_ITEMS} more)` : shown;
}

function cellText(cell: HtmlNode, ctx: Context): string {
  return renderFlow(cell.children, ctx)
    .join(" ")
    .replace(/\s*\n\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

function descendants(node: HtmlNode, names: Set<string>, stopAt: Set<string>, into: HtmlNode[] = []): HtmlNode[] {
  for (const child of node.children) {
    if (typeof child === "string") continue;
    if (names.has(child.tag)) into.push(child);
    else if (!stopAt.has(child.tag)) descendants(child, names, stopAt, into);
  }
  return into;
}

const TABLE_BLOCKS = new Set(["p", "div", "ul", "ol", "table", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "dl", "form", "section", "article"]);

function renderTable(node: HtmlNode, ctx: Context): string[] {
  const rows = descendants(node, new Set(["tr"]), new Set(["table", "td", "th"]));
  const caption = node.children.find((child): child is HtmlNode => typeof child !== "string" && child.tag === "caption");
  const captionText = caption ? clean(plain(caption)) : "";
  const cellsOf = (row: HtmlNode): HtmlNode[] => row.children.filter((child): child is HtmlNode => typeof child !== "string" && (child.tag === "td" || child.tag === "th"));
  const layout = attr(node, "role") === "presentation" || attr(node, "role") === "none" || rows.some((row) => cellsOf(row).some((cell) => cell.children.some((child) => typeof child !== "string" && TABLE_BLOCKS.has(child.tag))));
  if (layout) {
    const blocks: string[] = captionText ? [captionText] : [];
    for (const row of rows) for (const cell of cellsOf(row)) blocks.push(...renderFlow(cell.children, ctx));
    return blocks;
  }
  const grid: string[][] = [];
  let headerRows = 0;
  let sawBodyRow = false;
  for (const row of rows.slice(0, MAX_TABLE_ROWS)) {
    const cells = cellsOf(row);
    if (cells.length === 0) continue;
    const line: string[] = [];
    for (const cell of cells) {
      // A markdown table cannot span, so a short span keeps the columns lined up and a long one (a full-width note) stays one cell.
      const requested = Number.parseInt(attr(cell, "colspan") ?? "1", 10) || 1;
      const span = requested >= 2 && requested <= 4 ? requested : 1;
      line.push(cellText(cell, ctx));
      for (let k = 1; k < span; k += 1) line.push("");
    }
    if (!sawBodyRow && cells.every((cell) => cell.tag === "th")) headerRows += 1;
    else sawBodyRow = true;
    grid.push(line.slice(0, MAX_TABLE_COLUMNS));
  }
  const notes: string[] = [];
  // A first row of one cell above rows of several is a title or a note, not a header.
  while (grid.length > 1 && grid[0].length === 1 && grid.slice(1).some((line) => line.length > 1)) notes.push(grid.shift()![0]);
  if (grid.length === 0) return captionText ? [captionText] : [];
  if (rows.length > MAX_TABLE_ROWS) ctx.warnings.add(`A table with ${rows.length} rows was cut to its first ${MAX_TABLE_ROWS}.`);
  // Without a header row (an all-<th> first row), the table is a list of records or a page layout: one line per row, empty cells dropped.
  if (headerRows === 0) {
    const records = grid.map((line) => line.filter(Boolean).join(" | ")).filter(Boolean);
    return [...(captionText ? [`Table: ${captionText}`] : []), ...notes.filter(Boolean), records.join("\n")];
  }
  const width = Math.max(...grid.map((line) => line.length));
  const pad = (line: string[]): string[] => [...line, ...Array(width - line.length).fill("")];
  const header = pad(grid[0]);
  const body = grid.slice(1);
  const lines = [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...body.map((line) => `| ${pad(line).join(" | ")} |`)];
  return [...(captionText ? [`Table: ${captionText}`] : []), ...notes.filter(Boolean), lines.join("\n")];
}

function renderList(node: HtmlNode, ordered: boolean, ctx: Context): string {
  const items = node.children.filter((child): child is HtmlNode => typeof child !== "string" && !SKIPPED.has(child.tag) && !isHidden(child));
  let number = Number.parseInt(attr(node, "start") ?? "1", 10);
  if (!Number.isFinite(number)) number = 1;
  const lines: string[] = [];
  for (const item of items) {
    const blocks = item.tag === "li" ? renderFlow(item.children, ctx) : renderFlow([item], ctx);
    if (blocks.length === 0) continue;
    const marker = ordered ? `${number}. ` : "- ";
    number += 1;
    const pad = " ".repeat(marker.length);
    const text = blocks.join("\n").split("\n");
    lines.push(`${marker}${text[0]}`, ...text.slice(1).map((line) => (line ? pad + line : line)));
  }
  return lines.join("\n");
}

function renderFlow(children: Array<HtmlNode | string>, ctx: Context): string[] {
  const blocks: string[] = [];
  const budget = ctx.budget;
  let buffer = "";
  const flush = (): void => {
    const text = paragraph(buffer);
    if (text) {
      blocks.push(text);
      budget.left -= text.length;
    }
    buffer = "";
  };
  const add = (text: string): void => {
    blocks.push(text);
    budget.left -= text.length;
  };
  for (const child of children) {
    if (budget.left <= 0) break;
    if (typeof child === "string") {
      buffer = appendText(buffer, child);
      continue;
    }
    if (isHidden(child) || ctx.skip.has(child)) continue;
    if (EMBEDS.has(child.tag)) {
      const label = embedLabel(child);
      if (label) buffer = appendPiece(buffer, ` ${label} `);
      continue;
    }
    if (SKIPPED.has(child.tag)) continue;
    const tag = child.tag;
    if (!BLOCKS.has(tag)) {
      if (hasBlock(child, ctx.memo)) {
        flush();
        const inner = renderFlow(child.children, ctx);
        const target = tag === "a" ? linkTarget(attr(child, "href"), ctx) : null;
        if (target && inner.length > 0) {
          const first = inner[0];
          const heading = /^(#{1,6} )(.*)$/s.exec(first);
          inner[0] = heading ? `${heading[1]}[${heading[2]}](${target})` : `[${first.replace(/\n/g, " ")}](${target})`;
        }
        blocks.push(...inner);
      } else {
        const piece = inlineElement(child, ctx);
        if (piece) buffer = appendPiece(buffer, piece);
      }
      continue;
    }
    flush();
    if (HEADINGS.has(tag)) {
      const text = paragraph(inlineChildren(child.children, ctx)).replace(/\n/g, " ");
      if (text) add(`${"#".repeat(Number(tag[1]))} ${text}`);
    } else if (tag === "ul" || tag === "ol" || tag === "menu" || tag === "dir") {
      const list = renderList(child, tag === "ol", ctx);
      if (list) add(list);
    } else if (tag === "table") {
      for (const block of renderTable(child, ctx)) add(block);
    } else if (tag === "pre") {
      const code = child.children.find((node): node is HtmlNode => typeof node !== "string" && node.tag === "code");
      const language = /(?:^|\s)(?:language|lang)-([\w+#-]+)/.exec(`${attr(child, "class") ?? ""} ${code ? attr(code, "class") ?? "" : ""}`)?.[1] ?? "";
      const body = preText(child).replace(/^\n/, "").replace(/\s+$/, "");
      if (body.trim()) add(`\`\`\`${language}\n${body}\n\`\`\``);
    } else if (tag === "blockquote") {
      const inner = renderFlow(child.children, ctx).join("\n\n");
      if (inner) add(inner.split("\n").map((line) => (line ? `> ${line}` : ">")).join("\n"));
    } else if (tag === "hr") {
      add("---");
    } else if (tag === "dl") {
      for (const block of renderDefinitionList(child, ctx)) add(block);
    } else if (tag === "figure") {
      blocks.push(...renderFlow(child.children, ctx));
    } else if (tag === "figcaption") {
      const text = paragraph(inlineChildren(child.children, ctx));
      if (text) add(`Figure: ${text}`);
    } else if (tag === "details") {
      blocks.push(...renderFlow(child.children, ctx));
    } else if (tag === "summary") {
      const text = paragraph(inlineChildren(child.children, ctx));
      if (text) add(`**${text.replace(/\n/g, " ")}**`);
    } else if (tag === "nav" || ((tag === "header" || tag === "footer" || tag === "aside") && linkDensity(child) > 0.6)) {
      const links = compactLinks(child);
      if (links) add(`${tag === "nav" ? "Navigation" : tag === "footer" ? "Footer links" : tag === "header" ? "Header links" : "Related links"}: ${links}`);
    } else {
      blocks.push(...renderFlow(child.children, ctx));
    }
  }
  flush();
  return blocks;
}

function preText(node: HtmlNode | string): string {
  if (typeof node === "string") return node;
  if (SKIPPED.has(node.tag) || isHidden(node)) return "";
  if (node.tag === "br") return "\n";
  let out = "";
  for (const child of node.children) out += preText(child);
  return out;
}

function renderDefinitionList(node: HtmlNode, ctx: Context): string[] {
  const lines: string[] = [];
  const visit = (parent: HtmlNode): void => {
    for (const child of parent.children) {
      if (typeof child === "string" || SKIPPED.has(child.tag) || isHidden(child)) continue;
      if (child.tag === "dt") {
        const text = paragraph(inlineChildren(child.children, ctx)).replace(/\n/g, " ");
        if (text) lines.push(text);
      } else if (child.tag === "dd") {
        const text = renderFlow(child.children, ctx).join("\n");
        if (text) lines.push(...text.split("\n").map((line, index) => (index === 0 ? `: ${line}` : `  ${line}`)));
      } else visit(child);
    }
  };
  visit(node);
  return lines.length > 0 ? [lines.join("\n")] : [];
}

// ---------------------------------------------------------------------------------------------------
// What the page declares

function findAll(node: HtmlNode, test: (node: HtmlNode) => boolean, into: HtmlNode[] = [], limit = 200): HtmlNode[] {
  for (const child of node.children) {
    if (typeof child === "string" || into.length >= limit) continue;
    if (test(child)) into.push(child);
    if (child.tag !== "svg" && child.tag !== "script" && child.tag !== "style") findAll(child, test, into, limit);
  }
  return into;
}

function jsonLdFacts(root: HtmlNode, facts: Map<string, string>): void {
  const scripts = findAll(root, (node) => node.tag === "script" && /ld\+json/i.test(node.attrs.type ?? ""), [], 8);
  const nameOf = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(nameOf).filter(Boolean).slice(0, 4).join(", ");
    if (value && typeof value === "object" && typeof (value as { name?: unknown }).name === "string") return (value as { name: string }).name;
    return "";
  };
  for (const script of scripts) {
    const source = script.children.filter((child): child is string => typeof child === "string").join("");
    if (source.length > 200_000) continue;
    let data: unknown;
    try {
      data = JSON.parse(source);
    } catch {
      continue;
    }
    const items: unknown[] = Array.isArray(data) ? data : data && typeof data === "object" && Array.isArray((data as { "@graph"?: unknown })["@graph"]) ? (data as { "@graph": unknown[] })["@graph"] : [data];
    for (const item of items.slice(0, 20)) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const type = nameOf(record["@type"]);
      if (!type || /^(?:WebSite|WebPage|BreadcrumbList|ImageObject|SearchAction|Organization|Person)$/.test(type)) {
        if (!(type === "WebPage" && typeof record.datePublished === "string")) continue;
      }
      if (type && !facts.has("Type")) facts.set("Type", type);
      if (typeof record.datePublished === "string" && !facts.has("Published")) facts.set("Published", record.datePublished);
      if (typeof record.dateModified === "string" && !facts.has("Updated")) facts.set("Updated", record.dateModified);
      const author = nameOf(record.author);
      if (author && !facts.has("Author")) facts.set("Author", author);
      if (typeof record.headline === "string" && !facts.has("Headline")) facts.set("Headline", record.headline);
    }
  }
}

function declaredFacts(root: HtmlNode): { title: string; facts: Map<string, string> } {
  const facts = new Map<string, string>();
  const metas = findAll(root, (node) => node.tag === "meta", [], 400);
  const meta = (key: string): string => {
    for (const node of metas) {
      if ((node.attrs.name ?? node.attrs.property ?? "").toLowerCase() === key && node.attrs.content) return clean(node.attrs.content);
    }
    return "";
  };
  const titleNode = findAll(root, (node) => node.tag === "title", [], 1)[0];
  const title = clean(titleNode ? plainRaw(titleNode) : "") || meta("og:title");
  const html = findAll(root, (node) => node.tag === "html", [], 1)[0];
  const lang = html?.attrs.lang ?? html?.attrs["xml:lang"];
  const canonical = findAll(root, (node) => node.tag === "link" && (node.attrs.rel ?? "").toLowerCase().split(/\s+/).includes("canonical"), [], 1)[0]?.attrs.href;
  if (lang) facts.set("Language", lang);
  if (canonical && /^https?:/i.test(canonical)) facts.set("Address", canonical);
  const description = meta("description") || meta("og:description");
  if (description) facts.set("Description", description);
  const site = meta("og:site_name");
  if (site) facts.set("Site", site);
  const author = meta("author") || meta("article:author") || meta("dc.creator");
  if (author) facts.set("Author", author);
  const published = meta("article:published_time") || meta("dc.date") || meta("date");
  if (published) facts.set("Published", published);
  const modified = meta("article:modified_time");
  if (modified) facts.set("Updated", modified);
  jsonLdFacts(root, facts);
  return { title, facts };
}

function plainRaw(node: HtmlNode): string {
  return node.children.map((child) => (typeof child === "string" ? child : plainRaw(child))).join("");
}

// ---------------------------------------------------------------------------------------------------
// Entry points

/** Reads an HTML document already decoded to a string. */
export function readHtmlString(source: string, options: BuildOptions & { includeFacts?: boolean } = {}): HtmlRead {
  const root = buildHtmlTree(source, options);
  const warnings = new Set<string>();
  const { title, facts } = options.includeFacts === false ? { title: "", facts: new Map<string, string>() } : declaredFacts(root);
  const main = findAll(root, (node) => node.tag === "main" || node.attrs.role === "main", [], 1)[0];
  const address = facts.get("Address") ?? "";
  const origin = /^https?:\/\/[^/]+/i.exec(address)?.[0] ?? "";
  const ctx: Context = { origin, warnings, skip: new Set(), memo: new Map(), budget: { left: MAX_OUTPUT } };
  let blocks: string[];
  // A <main> that holds a sliver of the page (a search box, a skip target) is not believed, as Koncord does not believe one under 200 characters.
  const mainLength = main ? clean(plain(main)).length : 0;
  const believed = main !== undefined && !isHidden(main) && mainLength >= 200 && mainLength >= clean(plain(root)).length * 0.25;
  if (main && believed) {
    const lead = renderFlow([main], ctx);
    ctx.skip.add(main);
    const rest = renderFlow(root.children, ctx);
    blocks = rest.length > 0 ? [...lead, "---", "Outside the main content:", ...rest] : lead;
  } else {
    blocks = renderFlow(root.children, ctx);
  }
  let body = blocks.join("\n\n");
  if (ctx.budget.left <= 0 || body.length > MAX_OUTPUT) {
    body = body.slice(0, MAX_OUTPUT);
    warnings.add(`The page is longer than ${MAX_OUTPUT.toLocaleString("en-US")} characters; the rest was not read.`);
  }

  const firstHeading = /^#{1,6} (.+)$/m.exec(body)?.[1]?.replace(/\*|\[|\]\([^)]*\)/g, "").trim() ?? "";
  const headingMatchesTitle = firstHeading !== "" && title !== "" && (title.toLowerCase().startsWith(firstHeading.toLowerCase()) || firstHeading.toLowerCase().startsWith(title.toLowerCase()));
  const head: string[] = [];
  if (title && !headingMatchesTitle) head.push(`# ${title}`);
  const factLines = [...facts].filter(([key]) => !(key === "Headline" && facts.get("Headline") === title)).map(([key, value]) => `${key}: ${value.length > 400 ? `${value.slice(0, 400)}…` : value}`);
  if (factLines.length > 0) head.push(`${factLines.join("\n")}`);
  const text = [...head, body].filter(Boolean).join("\n\n");

  const scripts = findAll(root, (node) => node.tag === "script", [], 50).length;
  if (body.replace(/[\s-]/g, "").length < 200 && scripts >= 3) warnings.add("This page appears to build its content with scripts, which are not run here. Only the static HTML was read.");
  return { text, warnings: [...warnings], facts: [...facts], encoding: undefined };
}

/** Reads the bytes of an HTML file. */
export function readHtml(bytes: Uint8Array, contentType = ""): HtmlRead {
  const decoded = decodeMarkup(bytes, charsetOf(contentType));
  // XHTML is XML: "/>" closes any element and a DOCTYPE may carry an internal subset.
  const xhtml = /^\s*<\?xml\b/.test(decoded.text.slice(0, 256)) || /xhtml\+xml/i.test(contentType);
  const read = readHtmlString(decoded.text, { xml: xhtml });
  const warnings = [...read.warnings];
  if (decoded.source === "windows-1252") warnings.unshift("The file declares no text encoding and is not valid UTF-8, so it was read as windows-1252.");
  return { ...read, warnings, encoding: decoded.encoding };
}
