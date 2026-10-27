// A small XML reader for the Office formats. It builds a tree of elements with namespace prefixes
// stripped from element names (w:p and a:p both become "p"; attributes keep their full names, so
// r:id stays distinguishable from id). It is not a general XML parser: it skips DTDs and processing
// instructions, and it refuses documents with an unreasonable number of elements.

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: Array<XmlElement | string>;
}

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return entities[body.toLowerCase()] ?? match;
  });
}

function localName(name: string): string {
  const colon = name.indexOf(":");
  return colon >= 0 ? name.slice(colon + 1) : name;
}

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of source.matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[match[1]] = decodeEntities(match[2] ?? match[3] ?? "");
  return attrs;
}

const MAX_ELEMENTS = 1_500_000;
const MAX_DEPTH = 256;

export function parseXml(source: string): XmlElement {
  const root: XmlElement = { name: "#document", attrs: {}, children: [] };
  const stack: XmlElement[] = [root];
  let count = 0;
  let index = 0;
  const length = source.length;
  while (index < length) {
    const open = source.indexOf("<", index);
    if (open < 0) {
      stack[stack.length - 1].children.push(decodeEntities(source.slice(index)));
      break;
    }
    if (open > index) stack[stack.length - 1].children.push(decodeEntities(source.slice(index, open)));
    if (source.startsWith("<!--", open)) {
      const end = source.indexOf("-->", open + 4);
      index = end < 0 ? length : end + 3;
    } else if (source.startsWith("<![CDATA[", open)) {
      const end = source.indexOf("]]>", open + 9);
      stack[stack.length - 1].children.push(source.slice(open + 9, end < 0 ? length : end));
      index = end < 0 ? length : end + 3;
    } else if (source.startsWith("<?", open)) {
      const end = source.indexOf("?>", open + 2);
      index = end < 0 ? length : end + 2;
    } else if (source.startsWith("<!", open)) {
      const end = source.indexOf(">", open + 2);
      index = end < 0 ? length : end + 1;
    } else if (source[open + 1] === "/") {
      const end = source.indexOf(">", open + 2);
      if (stack.length > 1) stack.pop();
      index = end < 0 ? length : end + 1;
    } else {
      let end = open + 1;
      let quote = "";
      while (end < length) {
        const char = source[end];
        if (quote) {
          if (char === quote) quote = "";
        } else if (char === '"' || char === "'") {
          quote = char;
        } else if (char === ">") {
          break;
        }
        end += 1;
      }
      const tag = source.slice(open + 1, end);
      const selfClosing = tag.endsWith("/");
      const body = selfClosing ? tag.slice(0, -1) : tag;
      const space = body.search(/\s/);
      const name = localName(space < 0 ? body : body.slice(0, space));
      const element: XmlElement = { name, attrs: space < 0 ? {} : parseAttributes(body.slice(space)), children: [] };
      count += 1;
      if (count > MAX_ELEMENTS) throw new Error("The document has too many elements to read safely.");
      stack[stack.length - 1].children.push(element);
      if (!selfClosing) {
        stack.push(element);
        if (stack.length > MAX_DEPTH) throw new Error("The document is nested too deeply to read safely.");
      }
      index = end + 1;
    }
  }
  return root;
}

export function elements(node: XmlElement, name?: string): XmlElement[] {
  return node.children.filter((child): child is XmlElement => typeof child !== "string" && (name === undefined || child.name === name));
}

export function first(node: XmlElement | undefined, ...path: string[]): XmlElement | undefined {
  let current = node;
  for (const name of path) {
    if (!current) return undefined;
    current = elements(current, name)[0];
  }
  return current;
}

/** All descendants with the given name, in document order. */
export function descendants(node: XmlElement, name: string, into: XmlElement[] = []): XmlElement[] {
  for (const child of node.children) {
    if (typeof child === "string") continue;
    if (child.name === name) into.push(child);
    descendants(child, name, into);
  }
  return into;
}

export function textOf(node: XmlElement): string {
  let out = "";
  for (const child of node.children) out += typeof child === "string" ? child : textOf(child);
  return out;
}
