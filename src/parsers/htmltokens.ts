// An HTML tokenizer that follows the HTML Standard's tokenization states for everything that decides
// what is text and what is markup: tags and attributes, comments, the raw-text, RCDATA and script
// content models (including script's escaped and double-escaped states), CDATA, and character
// references (named, with the legacy no-semicolon rule, and numeric, with the Windows-1252 remap).
// DOCTYPEs are read only as far as their closing ">" because nothing downstream uses their fields.
// It does not build a tree. It is checked against html5lib's tokenizer tests (tests/html.test.ts).
import { LONGEST_REFERENCE, NAMED_REFERENCES } from "./entities";

export type HtmlToken =
  | { type: "start"; name: string; attrs: Array<[string, string]>; selfClosing: boolean }
  | { type: "end"; name: string }
  | { type: "comment"; data: string }
  | { type: "text"; data: string }
  | { type: "doctype"; name: string | null };

export type TokenizerState = "data" | "rcdata" | "rawtext" | "script" | "plaintext" | "cdata";

export interface TokenizerOptions {
  /** Start in this state, as html5lib's tests do. */
  initialState?: TokenizerState;
  /** The tag name that "appropriate end tag" is checked against when starting in a raw state. */
  lastStartTag?: string;
  /** Switch to the content model a start tag asks for (script, style, textarea, title, ...). Default true. */
  autoSwitch?: boolean;
  /** True while inside svg or math, where title, style and the like are not raw text. */
  isForeign?: () => boolean;
  /** True where a CDATA section is allowed (inside svg or math). Default false: it reads as a bogus comment. */
  cdata?: () => boolean;
  /** Read as XML for tag syntax: "/>" closes any element. Default false. */
  xml?: boolean;
}

const C1: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6,
  0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c,
  0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a,
  0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

const isAlpha = (c: string): boolean => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
const isDigit = (c: string): boolean => c >= "0" && c <= "9";
const isAlnum = (c: string): boolean => isAlpha(c) || isDigit(c);
const isHex = (c: string): boolean => isDigit(c) || (c >= "a" && c <= "f") || (c >= "A" && c <= "F");
const isSpace = (c: string): boolean => c === " " || c === "\t" || c === "\n" || c === "\f";

/** Reads a character reference whose "&" has just been consumed. Returns the text it stands for and where reading resumes. */
export function readCharacterReference(s: string, i: number, inAttribute: boolean): [string, number] {
  const c = i < s.length ? s[i] : "";
  if (c === "#") {
    let j = i + 1;
    const hex = s[j] === "x" || s[j] === "X";
    if (hex) j += 1;
    const start = j;
    let value = 0;
    while (j < s.length && (hex ? isHex(s[j]) : isDigit(s[j]))) {
      value = Math.min(value * (hex ? 16 : 10) + Number.parseInt(s[j], 16), 0x110000);
      j += 1;
    }
    if (j === start) return [hex ? `&#${s[i + 1]}` : "&#", j];
    if (s[j] === ";") j += 1;
    if (value === 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) value = 0xfffd;
    else if (C1[value] !== undefined) value = C1[value];
    return [String.fromCodePoint(value), j];
  }
  if (!isAlnum(c)) return ["&", i];
  for (let length = Math.min(LONGEST_REFERENCE, s.length - i); length >= 2; length -= 1) {
    const value = NAMED_REFERENCES[s.slice(i, i + length)];
    if (value === undefined) continue;
    // In an attribute, a name that lacks its semicolon and is followed by "=" or a letter or digit is left as written.
    if (inAttribute && s[i + length - 1] !== ";") {
      const after = s[i + length];
      if (after !== undefined && (after === "=" || isAlnum(after))) return ["&", i];
    }
    return [value, i + length];
  }
  return ["&", i];
}

type State =
  | "data" | "rcdata" | "rawtext" | "script" | "plaintext"
  | "tagOpen" | "endTagOpen" | "tagName"
  | "rcdataLt" | "rcdataEndOpen" | "rcdataEndName"
  | "rawtextLt" | "rawtextEndOpen" | "rawtextEndName"
  | "scriptLt" | "scriptEndOpen" | "scriptEndName" | "scriptEscapeStart" | "scriptEscapeStartDash"
  | "scriptEscaped" | "scriptEscapedDash" | "scriptEscapedDashDash" | "scriptEscapedLt" | "scriptEscapedEndOpen" | "scriptEscapedEndName"
  | "scriptDoubleStart" | "scriptDouble" | "scriptDoubleDash" | "scriptDoubleDashDash" | "scriptDoubleLt" | "scriptDoubleEnd"
  | "beforeAttrName" | "attrName" | "afterAttrName" | "beforeAttrValue" | "attrValueDq" | "attrValueSq" | "attrValueUnq" | "afterAttrValueQuoted"
  | "selfClosing" | "bogusComment" | "markup"
  | "commentStart" | "commentStartDash" | "comment" | "commentLt" | "commentLtBang" | "commentLtBangDash" | "commentLtBangDashDash"
  | "commentEndDash" | "commentEnd" | "commentEndBang" | "doctype" | "cdata" | "cdataBracket" | "cdataEnd";

const RAW_ELEMENTS: Record<string, TokenizerState> = {
  title: "rcdata", textarea: "rcdata", style: "rawtext", xmp: "rawtext", iframe: "rawtext", noembed: "rawtext", noframes: "rawtext", script: "script", plaintext: "plaintext",
};

export function tokenizeHtml(input: string, emit: (token: HtmlToken) => void, options: TokenizerOptions = {}): void {
  const s = input.replace(/\r\n?/g, "\n");
  const n = s.length;
  const autoSwitch = options.autoSwitch ?? true;
  const xml = options.xml ?? false;
  let i = 0;
  let state: State = (options.initialState as State | undefined) ?? "data";
  let lastStart = options.lastStartTag ?? "";
  let text = "";
  let tagName = "";
  let isEnd = false;
  let selfClosing = false;
  let attrs: Array<[string, string]> = [];
  let attrName = "";
  let attrValue = "";
  let comment = "";
  let temp = "";
  let returnState: State = "data";

  const flushText = (): void => {
    if (text) {
      emit({ type: "text", data: text });
      text = "";
    }
  };
  const startAttr = (): void => {
    finishAttr();
    attrName = "";
    attrValue = "";
    pendingAttr = true;
  };
  let pendingAttr = false;
  function finishAttr(): void {
    if (!pendingAttr) return;
    pendingAttr = false;
    if (!attrs.some(([name]) => name === attrName)) attrs.push([attrName, attrValue]);
  }
  const newTag = (end: boolean): void => {
    tagName = "";
    isEnd = end;
    selfClosing = false;
    attrs = [];
    pendingAttr = false;
  };
  const emitTag = (): void => {
    finishAttr();
    flushText();
    if (isEnd) {
      emit({ type: "end", name: tagName });
    } else {
      lastStart = tagName;
      emit({ type: "start", name: tagName, attrs, selfClosing });
    }
    state = "data";
    if (!isEnd && autoSwitch) {
      const raw = RAW_ELEMENTS[tagName];
      if (raw && !(xml && selfClosing) && !options.isForeign?.()) state = raw as State;
    }
  };
  const emitComment = (): void => {
    flushText();
    emit({ type: "comment", data: comment });
  };
  const appropriate = (): boolean => tagName === lastStart;
  const inAttrState = (): boolean => returnState === "attrValueDq" || returnState === "attrValueSq" || returnState === "attrValueUnq";
  const lower = (c: string): string => (c >= "A" && c <= "Z" ? c.toLowerCase() : c);
  const reference = (): void => {
    const [value, next] = readCharacterReference(s, i, inAttrState());
    i = next;
    if (inAttrState()) attrValue += value;
    else text += value;
  };

  while (true) {
    const eof = i >= n;
    const c = eof ? "" : s[i];
    if (!eof) i += 1;
    // Within a state, `back()` reconsumes the current character.
    const back = (): void => {
      if (!eof) i -= 1;
    };
    switch (state) {
      case "data":
        if (eof) {
          flushText();
          return;
        }
        if (c === "&") {
          returnState = "data";
          const [value, next] = readCharacterReference(s, i, false);
          text += value;
          i = next;
        } else if (c === "<") state = "tagOpen";
        else text += c;
        break;
      case "rcdata":
        if (eof) {
          flushText();
          return;
        }
        if (c === "&") {
          returnState = "rcdata";
          reference();
        } else if (c === "<") state = "rcdataLt";
        else text += c === "\0" ? "�" : c;
        break;
      case "rawtext":
        if (eof) {
          flushText();
          return;
        }
        if (c === "<") state = "rawtextLt";
        else text += c === "\0" ? "�" : c;
        break;
      case "script":
        if (eof) {
          flushText();
          return;
        }
        if (c === "<") state = "scriptLt";
        else text += c === "\0" ? "�" : c;
        break;
      case "plaintext":
        if (eof) {
          flushText();
          return;
        }
        text += c === "\0" ? "�" : c;
        break;
      case "tagOpen":
        if (c === "!") state = "markup";
        else if (c === "/") state = "endTagOpen";
        else if (isAlpha(c) && c !== "") {
          newTag(false);
          back();
          state = "tagName";
        } else if (c === "?") {
          comment = "";
          back();
          state = "bogusComment";
        } else {
          text += "<";
          back();
          state = "data";
        }
        break;
      case "endTagOpen":
        if (eof) {
          text += "</";
          state = "data";
        } else if (isAlpha(c)) {
          newTag(true);
          back();
          state = "tagName";
        } else if (c === ">") state = "data";
        else {
          comment = "";
          back();
          state = "bogusComment";
        }
        break;
      case "tagName":
        if (eof) return flushText();
        if (isSpace(c)) state = "beforeAttrName";
        else if (c === "/") state = "selfClosing";
        else if (c === ">") emitTag();
        else tagName += c === "\0" ? "�" : lower(c);
        break;
      case "rcdataLt":
        if (c === "/") {
          temp = "";
          state = "rcdataEndOpen";
        } else {
          text += "<";
          back();
          state = "rcdata";
        }
        break;
      case "rcdataEndOpen":
        if (!eof && isAlpha(c)) {
          newTag(true);
          back();
          state = "rcdataEndName";
        } else {
          text += "</";
          back();
          state = "rcdata";
        }
        break;
      case "rawtextLt":
        if (c === "/") {
          temp = "";
          state = "rawtextEndOpen";
        } else {
          text += "<";
          back();
          state = "rawtext";
        }
        break;
      case "rawtextEndOpen":
        if (!eof && isAlpha(c)) {
          newTag(true);
          back();
          state = "rawtextEndName";
        } else {
          text += "</";
          back();
          state = "rawtext";
        }
        break;
      case "rcdataEndName":
      case "rawtextEndName":
      case "scriptEndName":
      case "scriptEscapedEndName": {
        const home: State = state === "rcdataEndName" ? "rcdata" : state === "rawtextEndName" ? "rawtext" : state === "scriptEndName" ? "script" : "scriptEscaped";
        if (!eof && isSpace(c) && appropriate()) state = "beforeAttrName";
        else if (c === "/" && appropriate()) state = "selfClosing";
        else if (c === ">" && appropriate()) emitTag();
        else if (!eof && isAlpha(c)) {
          tagName += lower(c);
          temp += c;
        } else {
          text += `</${temp}`;
          back();
          state = home;
        }
        break;
      }
      case "scriptLt":
        if (c === "/") {
          temp = "";
          state = "scriptEndOpen";
        } else if (c === "!") {
          text += "<!";
          state = "scriptEscapeStart";
        } else {
          text += "<";
          back();
          state = "script";
        }
        break;
      case "scriptEndOpen":
        if (!eof && isAlpha(c)) {
          newTag(true);
          back();
          state = "scriptEndName";
        } else {
          text += "</";
          back();
          state = "script";
        }
        break;
      case "scriptEscapeStart":
        if (c === "-") {
          text += "-";
          state = "scriptEscapeStartDash";
        } else {
          back();
          state = "script";
        }
        break;
      case "scriptEscapeStartDash":
        if (c === "-") {
          text += "-";
          state = "scriptEscapedDashDash";
        } else {
          back();
          state = "script";
        }
        break;
      case "scriptEscaped":
        if (eof) return flushText();
        if (c === "-") {
          text += "-";
          state = "scriptEscapedDash";
        } else if (c === "<") state = "scriptEscapedLt";
        else text += c === "\0" ? "�" : c;
        break;
      case "scriptEscapedDash":
        if (eof) return flushText();
        if (c === "-") {
          text += "-";
          state = "scriptEscapedDashDash";
        } else if (c === "<") state = "scriptEscapedLt";
        else {
          text += c === "\0" ? "�" : c;
          state = "scriptEscaped";
        }
        break;
      case "scriptEscapedDashDash":
        if (eof) return flushText();
        if (c === "-") text += "-";
        else if (c === "<") state = "scriptEscapedLt";
        else if (c === ">") {
          text += ">";
          state = "script";
        } else {
          text += c === "\0" ? "�" : c;
          state = "scriptEscaped";
        }
        break;
      case "scriptEscapedLt":
        if (c === "/") {
          temp = "";
          state = "scriptEscapedEndOpen";
        } else if (!eof && isAlpha(c)) {
          temp = "";
          text += "<";
          back();
          state = "scriptDoubleStart";
        } else {
          text += "<";
          back();
          state = "scriptEscaped";
        }
        break;
      case "scriptEscapedEndOpen":
        if (!eof && isAlpha(c)) {
          newTag(true);
          back();
          state = "scriptEscapedEndName";
        } else {
          text += "</";
          back();
          state = "scriptEscaped";
        }
        break;
      case "scriptDoubleStart":
        if (!eof && (isSpace(c) || c === "/" || c === ">")) {
          text += c;
          state = temp === "script" ? "scriptDouble" : "scriptEscaped";
        } else if (!eof && isAlpha(c)) {
          temp += lower(c);
          text += c;
        } else {
          back();
          state = "scriptEscaped";
        }
        break;
      case "scriptDouble":
        if (eof) return flushText();
        if (c === "-") {
          text += "-";
          state = "scriptDoubleDash";
        } else if (c === "<") {
          text += "<";
          state = "scriptDoubleLt";
        } else text += c === "\0" ? "�" : c;
        break;
      case "scriptDoubleDash":
        if (eof) return flushText();
        if (c === "-") {
          text += "-";
          state = "scriptDoubleDashDash";
        } else if (c === "<") {
          text += "<";
          state = "scriptDoubleLt";
        } else {
          text += c === "\0" ? "�" : c;
          state = "scriptDouble";
        }
        break;
      case "scriptDoubleDashDash":
        if (eof) return flushText();
        if (c === "-") text += "-";
        else if (c === "<") {
          text += "<";
          state = "scriptDoubleLt";
        } else if (c === ">") {
          text += ">";
          state = "script";
        } else {
          text += c === "\0" ? "�" : c;
          state = "scriptDouble";
        }
        break;
      case "scriptDoubleLt":
        if (c === "/") {
          temp = "";
          text += "/";
          state = "scriptDoubleEnd";
        } else {
          back();
          state = "scriptDouble";
        }
        break;
      case "scriptDoubleEnd":
        if (!eof && (isSpace(c) || c === "/" || c === ">")) {
          text += c;
          state = temp === "script" ? "scriptEscaped" : "scriptDouble";
        } else if (!eof && isAlpha(c)) {
          temp += lower(c);
          text += c;
        } else {
          back();
          state = "scriptDouble";
        }
        break;
      case "beforeAttrName":
        if (eof || c === "/" || c === ">") {
          back();
          state = "afterAttrName";
        } else if (isSpace(c)) {
          /* skip */
        } else if (c === "=") {
          startAttr();
          attrName = "=";
          state = "attrName";
        } else {
          startAttr();
          back();
          state = "attrName";
        }
        break;
      case "attrName":
        if (eof || isSpace(c) || c === "/" || c === ">") {
          back();
          state = "afterAttrName";
        } else if (c === "=") state = "beforeAttrValue";
        else attrName += c === "\0" ? "�" : lower(c);
        break;
      case "afterAttrName":
        if (isSpace(c)) {
          /* skip */
        } else if (c === "/") state = "selfClosing";
        else if (c === "=") state = "beforeAttrValue";
        else if (c === ">") emitTag();
        else if (eof) return flushText();
        else {
          startAttr();
          back();
          state = "attrName";
        }
        break;
      case "beforeAttrValue":
        if (isSpace(c)) {
          /* skip */
        } else if (c === '"') state = "attrValueDq";
        else if (c === "'") state = "attrValueSq";
        else if (c === ">") emitTag();
        else {
          back();
          state = "attrValueUnq";
        }
        break;
      case "attrValueDq":
      case "attrValueSq": {
        const quote = state === "attrValueDq" ? '"' : "'";
        if (eof) return flushText();
        if (c === quote) state = "afterAttrValueQuoted";
        else if (c === "&") {
          returnState = state;
          reference();
        } else attrValue += c === "\0" ? "�" : c;
        break;
      }
      case "attrValueUnq":
        if (eof) return flushText();
        if (isSpace(c)) state = "beforeAttrName";
        else if (c === "&") {
          returnState = "attrValueUnq";
          reference();
        } else if (c === ">") emitTag();
        else attrValue += c === "\0" ? "�" : c;
        break;
      case "afterAttrValueQuoted":
        if (eof) return flushText();
        if (isSpace(c)) state = "beforeAttrName";
        else if (c === "/") state = "selfClosing";
        else if (c === ">") emitTag();
        else {
          back();
          state = "beforeAttrName";
        }
        break;
      case "selfClosing":
        if (eof) return flushText();
        if (c === ">") {
          selfClosing = true;
          emitTag();
        } else {
          back();
          state = "beforeAttrName";
        }
        break;
      case "bogusComment":
        if (eof) {
          emitComment();
          return flushText();
        }
        if (c === ">") {
          emitComment();
          state = "data";
        } else comment += c === "\0" ? "�" : c;
        break;
      case "markup":
        back();
        if (s.startsWith("--", i)) {
          i += 2;
          comment = "";
          state = "commentStart";
        } else if (s.slice(i, i + 7).toUpperCase() === "DOCTYPE") {
          i += 7;
          state = "doctype";
        } else if (s.startsWith("[CDATA[", i) && options.cdata?.()) {
          i += 7;
          state = "cdata";
        } else {
          comment = "";
          state = "bogusComment";
        }
        break;
      case "doctype": {
        back();
        let end = s.indexOf(">", i);
        if (xml) {
          // XML allows an internal subset: <!DOCTYPE x [ ... ]>. It ends at the ">" after its closing "]", outside any quotes.
          let quote = "";
          let subset = false;
          for (let k = i; k < n; k += 1) {
            const ch = s[k];
            if (quote) {
              if (ch === quote) quote = "";
            } else if (ch === '"' || ch === "'") quote = ch;
            else if (ch === "[") subset = true;
            else if (ch === "]") subset = false;
            else if (ch === ">" && !subset) {
              end = k;
              break;
            }
          }
        }
        const body = s.slice(i, end < 0 ? n : end).trim().split(/[\s]/)[0] ?? "";
        flushText();
        emit({ type: "doctype", name: body ? body.toLowerCase() : null });
        i = end < 0 ? n : end + 1;
        state = "data";
        break;
      }
      case "commentStart":
        if (c === "-") state = "commentStartDash";
        else if (c === ">") {
          emitComment();
          state = "data";
        } else {
          back();
          state = "comment";
        }
        break;
      case "commentStartDash":
        if (c === "-") state = "commentEnd";
        else if (c === ">") {
          emitComment();
          state = "data";
        } else if (eof) {
          emitComment();
          return flushText();
        } else {
          comment += "-";
          back();
          state = "comment";
        }
        break;
      case "comment":
        if (eof) {
          emitComment();
          return flushText();
        }
        if (c === "<") {
          comment += c;
          state = "commentLt";
        } else if (c === "-") state = "commentEndDash";
        else comment += c === "\0" ? "�" : c;
        break;
      case "commentLt":
        if (c === "!") {
          comment += c;
          state = "commentLtBang";
        } else if (c === "<") comment += c;
        else {
          back();
          state = "comment";
        }
        break;
      case "commentLtBang":
        if (c === "-") state = "commentLtBangDash";
        else {
          back();
          state = "comment";
        }
        break;
      case "commentLtBangDash":
        if (c === "-") state = "commentLtBangDashDash";
        else {
          back();
          state = "commentEndDash";
        }
        break;
      case "commentLtBangDashDash":
        back();
        state = "commentEnd";
        break;
      case "commentEndDash":
        if (c === "-") state = "commentEnd";
        else if (eof) {
          emitComment();
          return flushText();
        } else {
          comment += "-";
          back();
          state = "comment";
        }
        break;
      case "commentEnd":
        if (c === ">") {
          emitComment();
          state = "data";
        } else if (c === "!") state = "commentEndBang";
        else if (c === "-") comment += "-";
        else if (eof) {
          emitComment();
          return flushText();
        } else {
          comment += "--";
          back();
          state = "comment";
        }
        break;
      case "commentEndBang":
        if (c === "-") {
          comment += "--!";
          state = "commentEndDash";
        } else if (c === ">") {
          emitComment();
          state = "data";
        } else if (eof) {
          emitComment();
          return flushText();
        } else {
          comment += "--!";
          back();
          state = "comment";
        }
        break;
      case "cdata":
        if (eof) return flushText();
        if (c === "]") state = "cdataBracket";
        else text += c;
        break;
      case "cdataBracket":
        if (c === "]") state = "cdataEnd";
        else {
          text += "]";
          back();
          state = "cdata";
        }
        break;
      case "cdataEnd":
        if (c === "]") text += "]";
        else if (c === ">") state = "data";
        else {
          text += "]]";
          back();
          state = "cdata";
        }
        break;
    }
  }
}
