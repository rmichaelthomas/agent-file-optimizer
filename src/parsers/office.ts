// Readers for DOCX, PPTX, and XLSX. Each takes the unzipped package (member name to bytes) and returns
// Markdown for people and agents, a few JSONL records, and warnings. They read the structure that
// the files actually have: styles for headings, numbering for lists, relationships for slide order and
// links, shared strings and number formats for spreadsheets. They do not render layout, and they do not
// read images, drawings, or embedded objects.
import { strFromU8 } from "fflate";
import { type XmlElement, descendants, elements, first, parseXml, textOf } from "./xml";

export interface OfficeResult {
  text: string;
  jsonl: string[];
  warnings: string[];
}

type Files = Map<string, Uint8Array>;

const MAX_SPREADSHEET_ROWS = 5000;
const MAX_SPREADSHEET_CHARS = 600_000;
const MAX_SPREADSHEET_COLUMNS = 16_384; // Excel's own limit, column XFD

function xml(files: Files, name: string): XmlElement | undefined {
  const bytes = files.get(name);
  if (!bytes) return undefined;
  try {
    return parseXml(strFromU8(bytes));
  } catch {
    return undefined;
  }
}

function directory(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(0, slash) : "";
}

function resolveTarget(basePart: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = directory(basePart).split("/").filter(Boolean);
  for (const piece of target.split("/")) {
    if (piece === "..") parts.pop();
    else if (piece !== ".") parts.push(piece);
  }
  return parts.join("/");
}

interface Relationship {
  target: string;
  external: boolean;
  type: string;
}

function relationships(files: Files, part: string): Map<string, Relationship> {
  const slash = part.lastIndexOf("/");
  const relsPath = `${slash >= 0 ? part.slice(0, slash + 1) : ""}_rels/${part.slice(slash + 1)}.rels`;
  const map = new Map<string, Relationship>();
  const root = xml(files, relsPath);
  if (!root) return map;
  for (const rel of descendants(root, "Relationship")) {
    const id = rel.attrs.Id;
    const target = rel.attrs.Target;
    if (!id || !target) continue;
    const external = rel.attrs.TargetMode === "External";
    map.set(id, { target: external ? target : resolveTarget(part, target), external, type: rel.attrs.Type ?? "" });
  }
  return map;
}

function mainPart(files: Files, fallback: string): string {
  const root = xml(files, "_rels/.rels");
  if (root) {
    for (const rel of descendants(root, "Relationship")) {
      if (rel.attrs.Type?.endsWith("/officeDocument") && rel.attrs.Target) return resolveTarget("_rels/.rels", rel.attrs.Target).replace(/^_rels\//, "");
    }
  }
  return fallback;
}

function metadata(files: Files): string[] {
  const core = xml(files, "docProps/core.xml");
  if (!core) return [];
  const pick = (name: string) => descendants(core, name).map(textOf).join("").trim();
  const lines: string[] = [];
  const title = pick("title");
  const creator = pick("creator");
  const modified = pick("modified");
  if (title) lines.push(`Title: ${title}`);
  if (creator) lines.push(`Author: ${creator}`);
  if (modified) lines.push(`Modified: ${modified}`);
  return lines;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();
}

function markdownTable(rows: string[][]): string {
  const width = Math.max(1, ...rows.map((row) => row.length));
  const pad = (row: string[]) => [...row.map(escapeCell), ...Array(width - row.length).fill("")];
  const lines = rows.map((row) => `| ${pad(row).join(" | ")} |`);
  lines.splice(1, 0, `| ${Array(width).fill("---").join(" | ")} |`);
  return lines.join("\n");
}

// ---------------------------------------------------------------- DOCX

interface StyleInfo {
  name: string;
  basedOn?: string;
  outline?: number;
  numId?: string;
  ilvl?: number;
}

function val(node: XmlElement | undefined): string | undefined {
  return node?.attrs["w:val"];
}

export function readDocx(files: Files): OfficeResult | null {
  const mainName = mainPart(files, "word/document.xml");
  const document = xml(files, mainName);
  const body = first(document, "document", "body");
  if (!body) return null;
  const rels = relationships(files, mainName);

  const styles = new Map<string, StyleInfo>();
  const stylesRoot = xml(files, "word/styles.xml");
  if (stylesRoot) {
    for (const style of descendants(stylesRoot, "style")) {
      const id = style.attrs["w:styleId"];
      if (!id) continue;
      const pPr = first(style, "pPr");
      const outline = val(first(pPr, "outlineLvl"));
      const numPr = first(pPr, "numPr");
      styles.set(id, {
        name: (val(first(style, "name")) ?? id).toLowerCase(),
        basedOn: val(first(style, "basedOn")),
        outline: outline !== undefined ? Number(outline) + 1 : undefined,
        numId: val(first(numPr, "numId")),
        ilvl: val(first(numPr, "ilvl")) !== undefined ? Number(val(first(numPr, "ilvl"))) : undefined,
      });
    }
  }

  // numbering: numId -> abstractNum -> level -> bullet or numbered
  const abstractLevels = new Map<string, Map<number, string>>();
  const numToAbstract = new Map<string, string>();
  const numberingRoot = xml(files, "word/numbering.xml");
  if (numberingRoot) {
    for (const abstract of descendants(numberingRoot, "abstractNum")) {
      const id = abstract.attrs["w:abstractNumId"];
      if (!id) continue;
      const levels = new Map<number, string>();
      for (const level of elements(abstract, "lvl")) levels.set(Number(level.attrs["w:ilvl"] ?? 0), val(first(level, "numFmt")) ?? "decimal");
      abstractLevels.set(id, levels);
    }
    for (const num of descendants(numberingRoot, "num")) {
      const id = num.attrs["w:numId"];
      const abstract = val(first(num, "abstractNumId"));
      if (id && abstract) numToAbstract.set(id, abstract);
    }
  }

  const counters = new Map<string, number[]>();
  const footnoteOrder = new Map<string, number>();
  const noteNumber = (key: string): number => {
    let n = footnoteOrder.get(key);
    if (n === undefined) {
      n = footnoteOrder.size + 1;
      footnoteOrder.set(key, n);
    }
    return n;
  };

  function styleChain(styleId: string | undefined): StyleInfo[] {
    const chain: StyleInfo[] = [];
    let current = styleId;
    for (let depth = 0; current && depth < 8; depth += 1) {
      const info = styles.get(current);
      if (!info) break;
      chain.push(info);
      current = info.basedOn;
    }
    return chain;
  }

  function headingLevel(pPr: XmlElement | undefined): number {
    const direct = val(first(pPr, "outlineLvl"));
    if (direct !== undefined && Number(direct) < 9) return Number(direct) + 1;
    const styleId = val(first(pPr, "pStyle"));
    // A style can inherit "heading N" and outline levels, but not "Title": Author and Date styles are often based on Title and are not headings.
    const chain = styleChain(styleId);
    for (const [index, info] of chain.entries()) {
      const match = /^heading\s*(\d)$/.exec(info.name);
      if (match) return Number(match[1]);
      if (index === 0 && info.name === "title") return 1;
      if (index === 0 && info.name === "subtitle") return 2;
      if (info.outline !== undefined && info.outline < 10) return info.outline;
    }
    return 0;
  }

  function listInfo(pPr: XmlElement | undefined): { numId: string; ilvl: number } | null {
    const numPr = first(pPr, "numPr");
    let numId = val(first(numPr, "numId"));
    let ilvl = val(first(numPr, "ilvl")) !== undefined ? Number(val(first(numPr, "ilvl"))) : undefined;
    if (numId === undefined) {
      for (const info of styleChain(val(first(pPr, "pStyle")))) {
        if (info.numId !== undefined) {
          numId = info.numId;
          ilvl ??= info.ilvl;
          break;
        }
      }
    }
    if (numId === undefined || numId === "0") return null;
    return { numId, ilvl: ilvl ?? 0 };
  }

  const extraParagraphs: string[] = [];

  function runsText(node: XmlElement): string {
    let out = "";
    for (const child of node.children) {
      if (typeof child === "string") continue;
      switch (child.name) {
        case "r":
          out += runText(child);
          break;
        case "hyperlink": {
          const inner = runsText(child);
          const id = child.attrs["r:id"];
          const rel = id ? rels.get(id) : undefined;
          out += rel?.external && inner.trim() ? `[${inner.trim()}](${rel.target})` : inner;
          break;
        }
        case "ins":
        case "smartTag":
        case "sdt":
        case "sdtContent":
        case "fldSimple":
        case "customXml":
        case "moveTo":
        case "bdo":
        case "dir":
          out += runsText(child);
          break;
        default:
          break;
      }
    }
    return out;
  }

  function runText(run: XmlElement): string {
    let out = "";
    for (const child of run.children) {
      if (typeof child === "string") continue;
      switch (child.name) {
        case "t":
          out += textOf(child);
          break;
        case "tab":
          out += "\t";
          break;
        case "br":
        case "cr":
          if (child.attrs["w:type"] !== "page") out += "\n";
          break;
        case "noBreakHyphen":
          out += "-";
          break;
        case "footnoteReference": {
          const id = child.attrs["w:id"];
          if (id) out += `[^${noteNumber(id)}]`;
          break;
        }
        case "endnoteReference": {
          const id = child.attrs["w:id"];
          if (id) out += `[^${noteNumber(`e${id}`)}]`;
          break;
        }
        case "drawing":
        case "pict":
          drawingText(child);
          break;
        case "AlternateContent": {
          const choice = first(child, "Choice");
          if (choice) drawingText(choice);
          break;
        }
        default:
          break;
      }
    }
    return out;
  }

  /** Text boxes hold their own paragraphs; picture alt text is worth keeping. Both are added after the paragraph. */
  function drawingText(node: XmlElement): void {
    for (const box of descendants(node, "txbxContent")) {
      const texts = blocks(box, 0);
      if (texts.length > 0) extraParagraphs.push(...texts);
    }
    for (const doc of descendants(node, "docPr")) {
      const alt = (doc.attrs.descr ?? "").trim();
      if (alt) extraParagraphs.push(`[Image: ${alt}]`);
    }
  }

  function paragraph(p: XmlElement): string[] {
    const pPr = first(p, "pPr");
    const outer = extraParagraphs.splice(0);
    const raw = runsText(p);
    const text = raw.replace(/[ \t]+\n/g, "\n").replace(/\u00a0/g, " ").trim();
    const extras = extraParagraphs.splice(0);
    extraParagraphs.push(...outer);
    const lines: string[] = [];
    if (text) {
      const level = headingLevel(pPr);
      const list = level === 0 ? listInfo(pPr) : null;
      if (level > 0) {
        lines.push(`${"#".repeat(Math.min(level, 6))} ${text.replace(/\n/g, " ")}`);
      } else if (list) {
        const abstract = numToAbstract.get(list.numId);
        const format = (abstract ? abstractLevels.get(abstract)?.get(list.ilvl) : undefined) ?? "bullet";
        const indent = "  ".repeat(Math.min(list.ilvl, 6));
        if (format === "bullet" || format === "none") {
          lines.push(`${indent}- ${text.replace(/\n/g, " ")}`);
        } else {
          const levels = counters.get(list.numId) ?? [];
          levels.length = list.ilvl + 1;
          levels[list.ilvl] = (levels[list.ilvl] ?? 0) + 1;
          for (let i = 0; i < list.ilvl; i += 1) levels[i] ??= 1;
          counters.set(list.numId, levels);
          lines.push(`${indent}${levels[list.ilvl]}. ${text.replace(/\n/g, " ")}`);
        }
      } else {
        lines.push(text);
      }
    }
    lines.push(...extras);
    return lines;
  }

  function cellText(cell: XmlElement): string {
    return blocks(cell, 0).join(" ").replace(/\s+/g, " ").trim();
  }

  function table(tbl: XmlElement): string {
    const rows: string[][] = [];
    for (const tr of elements(tbl, "tr")) {
      const cells: string[] = [];
      for (const tc of elements(tr, "tc")) {
        cells.push(cellText(tc));
        const span = Number(val(first(first(tc, "tcPr"), "gridSpan")) ?? 1);
        for (let i = 1; i < span && i < 30; i += 1) cells.push("");
      }
      if (cells.length > 0) rows.push(cells);
    }
    return rows.length > 0 ? markdownTable(rows) : "";
  }

  /** Blocks in a container, each a paragraph line, a list line, or a whole table. */
  function blocks(container: XmlElement, depth: number): string[] {
    const out: string[] = [];
    if (depth > 12) return out;
    for (const child of container.children) {
      if (typeof child === "string") continue;
      if (child.name === "p") out.push(...paragraph(child));
      else if (child.name === "tbl") {
        const rendered = table(child);
        if (rendered) out.push(rendered);
      } else if (child.name === "sdt") {
        const content = first(child, "sdtContent");
        if (content) out.push(...blocks(content, depth + 1));
      }
    }
    return out;
  }

  const bodyBlocks = blocks(body, 0);
  const sections: string[] = [];
  const meta = metadata(files);
  if (meta.length > 0) sections.push(meta.join("\n"));
  // Join list items tightly and everything else with a blank line.
  let main = "";
  bodyBlocks.forEach((block, index) => {
    const isList = /^\s*(?:- |\d+\. )/.test(block);
    const previousIsList = index > 0 && /^\s*(?:- |\d+\. )/.test(bodyBlocks[index - 1]);
    main += index === 0 ? block : isList && previousIsList ? `\n${block}` : `\n\n${block}`;
  });
  if (main.trim()) sections.push(main);

  const warnings: string[] = [];
  const noteBodies = new Map<number, string>();
  const collectNotes = (rootName: string, partName: string, prefix: string): void => {
    const root = xml(files, partName);
    if (!root) return;
    for (const note of descendants(root, rootName)) {
      const id = note.attrs["w:id"];
      if (!id || note.attrs["w:type"]) continue;
      const number = footnoteOrder.get(`${prefix}${id}`);
      const body = blocks(note, 0).join(" ").replace(/\s+/g, " ").trim();
      if (number !== undefined && body) noteBodies.set(number, body);
    }
  };
  collectNotes("footnote", "word/footnotes.xml", "");
  collectNotes("endnote", "word/endnotes.xml", "e");
  if (noteBodies.size > 0) sections.push(`## Footnotes\n\n${[...noteBodies].sort((a, b) => a[0] - b[0]).map(([n, body]) => `[^${n}]: ${body}`).join("\n")}`);

  const commentsRoot = xml(files, "word/comments.xml");
  if (commentsRoot) {
    const comments = descendants(commentsRoot, "comment").map((comment) => {
      const author = comment.attrs["w:author"] ?? "Someone";
      const text = blocks(comment, 0).join(" ").replace(/\s+/g, " ").trim();
      return text ? `- ${author}: ${text}` : "";
    }).filter(Boolean);
    if (comments.length > 0) sections.push(`## Comments\n\n${comments.join("\n")}`);
  }

  const headerFooter: string[] = [];
  const seen = new Set<string>();
  for (const name of [...files.keys()].filter((n) => /^word\/(?:header|footer)\d*\.xml$/i.test(n)).sort((a, b) => Number(/footer/i.test(a)) - Number(/footer/i.test(b)) || a.localeCompare(b))) {
    const root = xml(files, name);
    if (!root) continue;
    const text = blocks(root.children.find((c): c is XmlElement => typeof c !== "string") ?? root, 0).join(" ").replace(/\s+/g, " ").trim();
    if (text && !seen.has(text)) {
      seen.add(text);
      headerFooter.push(`- ${/header/i.test(name) ? "Header" : "Footer"}: ${text}`);
    }
  }
  if (headerFooter.length > 0) sections.push(`## Headers and footers\n\n${headerFooter.join("\n")}`);

  const text = sections.join("\n\n").trim();
  if (!text) return null;
  const jsonl = bodyBlocks.map((block) => JSON.stringify({ text: block }));
  if (descendants(body, "drawing").length > 0 && !text.includes("[Image:")) warnings.push("Pictures and drawings are not read; only text boxes and picture descriptions are.");
  return { text, jsonl, warnings };
}

// ---------------------------------------------------------------- PPTX

export function readPptx(files: Files): OfficeResult | null {
  const mainName = mainPart(files, "ppt/presentation.xml");
  const presentation = xml(files, mainName);
  if (!presentation) return null;
  const rels = relationships(files, mainName);
  const slidePaths: string[] = [];
  for (const slideId of descendants(presentation, "sldId")) {
    const target = rels.get(slideId.attrs["r:id"] ?? "")?.target;
    if (target && files.has(target)) slidePaths.push(target);
  }
  if (slidePaths.length === 0) {
    slidePaths.push(...[...files.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n)).sort((a, b) => Number(/(\d+)\.xml$/.exec(a)?.[1]) - Number(/(\d+)\.xml$/.exec(b)?.[1])));
  }

  const warnings: string[] = [];
  const jsonl: string[] = [];
  const sections: string[] = [];
  const meta = metadata(files);
  if (meta.length > 0) sections.push(meta.join("\n"));

  const skipPlaceholders = new Set(["sldNum", "dt", "ftr", "hdr"]);

  function paragraphLines(txBody: XmlElement, asTitle: boolean, inheritsBullets = false): string[] {
    const lines: string[] = [];
    for (const p of elements(txBody, "p")) {
      let text = "";
      for (const child of p.children) {
        if (typeof child === "string") continue;
        if (child.name === "r") text += textOf(first(child, "t") ?? child);
        else if (child.name === "fld") text += textOf(first(child, "t") ?? child);
        else if (child.name === "br") text += " ";
      }
      text = text.replace(/\s+/g, " ").trim();
      if (!text) continue;
      if (asTitle) {
        lines.push(text);
        continue;
      }
      const pPr = first(p, "pPr");
      const level = Number(pPr?.attrs.lvl ?? 0);
      const hasBullet = pPr ? elements(pPr).some((c) => c.name === "buChar" || c.name === "buAutoNum") : false;
      const noBullet = pPr ? elements(pPr).some((c) => c.name === "buNone") : false;
      lines.push(hasBullet || (!noBullet && (level > 0 || inheritsBullets)) ? `${"  ".repeat(Math.min(level, 6))}- ${text}` : text);
    }
    return lines;
  }

  function tableText(tbl: XmlElement): string {
    const rows = elements(tbl, "tr").map((tr) => elements(tr, "tc").map((tc) => elements(tc, "txBody").flatMap((body) => paragraphLines(body, true)).join(" ")));
    return rows.length > 0 ? markdownTable(rows) : "";
  }

  function chartText(graphicFrame: XmlElement, slideRels: Map<string, Relationship>): string {
    const chartRef = descendants(graphicFrame, "chart")[0];
    const target = slideRels.get(chartRef?.attrs["r:id"] ?? "")?.target;
    const chart = target ? xml(files, target) : undefined;
    if (!chart) return "";
    const title = descendants(chart, "title").map((t) => descendants(t, "t").map(textOf).join("")).find(Boolean) ?? "";
    const series = descendants(chart, "ser").map((ser) => {
      const name = descendants(first(ser, "tx") ?? ser, "v").map(textOf)[0] ?? "";
      const cats = descendants(first(ser, "cat") ?? ser, "v").map(textOf);
      const vals = descendants(first(ser, "val") ?? ser, "v").map(textOf);
      return { name, cats, vals };
    });
    if (series.length === 0 && !title) return "";
    const lines = [`Chart${title ? `: ${title}` : ""}`];
    for (const s of series) {
      const points = s.vals.map((value, i) => (s.cats[i] ? `${s.cats[i]}=${value}` : value)).join(", ");
      lines.push(`- ${s.name || "Series"}: ${points}`);
    }
    return lines.join("\n");
  }

  slidePaths.forEach((path, index) => {
    const slide = xml(files, path);
    if (!slide) return;
    const slideRels = relationships(files, path);
    const tree = first(slide, "sld", "cSld", "spTree");
    if (!tree) return;
    let title = "";
    const body: string[] = [];

    const visit = (container: XmlElement, depth: number): void => {
      if (depth > 8) return;
      for (const child of elements(container)) {
        if (child.name === "grpSp") {
          visit(child, depth + 1);
        } else if (child.name === "sp") {
          const ph = descendants(first(child, "nvSpPr") ?? child, "ph")[0];
          const type = ph?.attrs.type;
          if (type && skipPlaceholders.has(type)) continue;
          const txBody = first(child, "txBody");
          if (!txBody) continue;
          const isTitle = type === "title" || type === "ctrTitle";
          // A content placeholder inherits its bullets from the slide layout, so its paragraphs are list items unless they say otherwise.
          const lines = paragraphLines(txBody, isTitle, ph !== undefined && (type === undefined || type === "body" || type === "obj"));
          if (isTitle) title = title || lines.join(" ");
          else body.push(...lines);
        } else if (child.name === "graphicFrame") {
          const tbl = descendants(child, "tbl")[0];
          if (tbl) {
            const rendered = tableText(tbl);
            if (rendered) body.push(rendered);
          } else {
            const chart = chartText(child, slideRels);
            if (chart) body.push(chart);
          }
        } else if (child.name === "pic") {
          const alt = (descendants(child, "cNvPr")[0]?.attrs.descr ?? "").trim();
          if (alt) body.push(`[Image: ${alt}]`);
        }
      }
    };
    visit(tree, 0);

    let notes = "";
    const notesRel = [...slideRels.values()].find((rel) => rel.type.endsWith("/notesSlide"));
    const notesRoot = notesRel ? xml(files, notesRel.target) : undefined;
    if (notesRoot) {
      const lines: string[] = [];
      for (const sp of descendants(notesRoot, "sp")) {
        const type = descendants(first(sp, "nvSpPr") ?? sp, "ph")[0]?.attrs.type;
        if (type !== "body") continue;
        const txBody = first(sp, "txBody");
        if (txBody) lines.push(...paragraphLines(txBody, true));
      }
      notes = lines.join(" ").trim();
    }

    const heading = `## Slide ${index + 1}${title ? `: ${title}` : ""}`;
    const parts = [heading, ...(body.length > 0 ? [body.join("\n")] : []), ...(notes ? [`> Notes: ${notes}`] : [])];
    sections.push(parts.join("\n\n"));
    jsonl.push(JSON.stringify({ slide: index + 1, title, text: body.join("\n"), notes }));
  });

  if (jsonl.length === 0) return null;
  warnings.push("Slide layout, pictures, and animations are not read; titles, text, tables, chart data, picture descriptions, and speaker notes are.");
  return { text: sections.join("\n\n").trim(), jsonl, warnings };
}

// ---------------------------------------------------------------- XLSX

function columnIndex(reference: string): number {
  let index = 0;
  for (const char of reference.replace(/[^A-Za-z]/g, "").toUpperCase()) index = index * 26 + (char.charCodeAt(0) - 64);
  return Math.max(index - 1, 0);
}

const builtinDateFormats = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

function isDateFormatCode(code: string): boolean {
  const stripped = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "");
  return /[ymdhs]/i.test(stripped) && !/^general$/i.test(stripped.trim());
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

function serialToText(serial: number, epoch1904: boolean): string {
  const base = epoch1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const date = new Date(base + Math.round(serial * 86_400_000));
  if (Number.isNaN(date.getTime())) return String(serial);
  const time = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
  if (serial >= 0 && serial < 1) return time;
  const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  return Number.isInteger(serial) ? day : `${day} ${date.getUTCSeconds() ? time : time.slice(0, 5)}`;
}

function cleanNumber(raw: string): string {
  const number = Number(raw);
  if (!Number.isFinite(number)) return raw;
  return String(Number.parseFloat(number.toPrecision(15)));
}

export function readXlsx(files: Files): OfficeResult | null {
  const mainName = mainPart(files, "xl/workbook.xml");
  const workbook = xml(files, mainName);
  if (!workbook) return null;
  const rels = relationships(files, mainName);
  const epoch1904 = descendants(workbook, "workbookPr").some((node) => node.attrs.date1904 === "1" || node.attrs.date1904 === "true");

  const shared: string[] = [];
  const sharedRoot = xml(files, "xl/sharedStrings.xml");
  if (sharedRoot) {
    for (const si of descendants(sharedRoot, "si")) {
      // Phonetic runs (rPh) are readings, not the cell's text.
      const parts = descendants(si, "t").filter((t) => !isInsidePhonetic(si, t));
      shared.push(parts.map(textOf).join(""));
    }
  }

  const dateStyle: boolean[] = [];
  const stylesRoot = xml(files, "xl/styles.xml");
  if (stylesRoot) {
    const customCodes = new Map<number, string>();
    for (const fmt of descendants(stylesRoot, "numFmt")) customCodes.set(Number(fmt.attrs.numFmtId), fmt.attrs.formatCode ?? "");
    const cellXfs = first(stylesRoot, "styleSheet", "cellXfs");
    for (const xf of cellXfs ? elements(cellXfs, "xf") : []) {
      const id = Number(xf.attrs.numFmtId ?? 0);
      dateStyle.push(customCodes.has(id) ? isDateFormatCode(customCodes.get(id) ?? "") : builtinDateFormats.has(id));
    }
  }

  const sheets: Array<{ name: string; path: string; hidden: boolean }> = [];
  for (const sheet of descendants(workbook, "sheet")) {
    const name = sheet.attrs.name;
    const target = rels.get(sheet.attrs["r:id"] ?? "")?.target;
    if (name && target && files.has(target)) sheets.push({ name, path: target, hidden: sheet.attrs.state === "hidden" || sheet.attrs.state === "veryHidden" });
  }
  if (sheets.length === 0) return null;

  const sections: string[] = [];
  const jsonl: string[] = [];
  const warnings: string[] = [];
  let totalChars = 0;
  const meta = metadata(files);
  if (meta.length > 0) sections.push(meta.join("\n"));

  for (const sheet of sheets) {
    const root = xml(files, sheet.path);
    const data = root ? first(root, "worksheet", "sheetData") : undefined;
    if (!data) continue;
    const rows: string[] = [];
    let omitted = 0;
    for (const row of elements(data, "row")) {
      if (rows.length >= MAX_SPREADSHEET_ROWS || totalChars > MAX_SPREADSHEET_CHARS) {
        omitted += 1;
        continue;
      }
      const cells: string[] = [];
      for (const cell of elements(row, "c")) {
        const type = cell.attrs.t;
        const reference = cell.attrs.r;
        const raw = textOf(first(cell, "v") ?? { name: "v", attrs: {}, children: [] });
        const formula = first(cell, "f");
        let value = "";
        if (type === "inlineStr") value = descendants(first(cell, "is") ?? cell, "t").map(textOf).join("");
        else if (type === "s") value = shared[Number(raw)] ?? "";
        else if (type === "str" || type === "e") value = raw;
        else if (type === "b") value = raw === "1" ? "TRUE" : "FALSE";
        else if (raw !== "") {
          const style = Number(cell.attrs.s ?? -1);
          value = dateStyle[style] && Number.isFinite(Number(raw)) ? serialToText(Number(raw), epoch1904) : cleanNumber(raw);
        } else if (formula) {
          value = `=${textOf(formula)}`;
        }
        const column = reference ? columnIndex(reference) : cells.length;
        if (column > MAX_SPREADSHEET_COLUMNS) continue;
        while (cells.length < column) cells.push("");
        cells.push(value.replace(/[\t\r\n]+/g, " ").trim());
      }
      while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
      if (cells.length > 0) {
        const line = cells.join("\t");
        rows.push(line);
        totalChars += line.length + 1;
      }
    }
    if (rows.length === 0) continue;
    if (omitted > 0) warnings.push(`Sheet "${sheet.name}": ${omitted} more row(s) were left out to keep the notes a readable size. The original has them.`);
    const label = `### Sheet: ${sheet.name}${sheet.hidden ? " (hidden)" : ""}`;
    sections.push(`${label}\n\n${rows.join("\n")}`);
    jsonl.push(JSON.stringify({ sheet: sheet.name, hidden: sheet.hidden, rows: rows.length, text: rows.join("\n") }));
  }

  if (jsonl.length === 0) return null;
  warnings.push("Cells are shown as stored: numbers are not formatted as currency or percentages, and formulas show their last calculated value.");
  return { text: sections.join("\n\n").trim(), jsonl, warnings };
}

function isInsidePhonetic(root: XmlElement, target: XmlElement): boolean {
  for (const child of root.children) {
    if (typeof child === "string") continue;
    if (child.name === "rPh") {
      if (child === target || descendants(child, "t").includes(target)) return true;
    }
  }
  return false;
}

