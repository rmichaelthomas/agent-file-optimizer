import type { SafetyAssessment } from "./types";

const riskyExtensions = new Set([".exe", ".dll", ".dmg", ".app", ".sh", ".bash", ".bat", ".cmd", ".ps1", ".msi"]);

export function basicSafetyCheck(path: string, contentType: string, bytes: Uint8Array): SafetyAssessment {
  const signals: string[] = [];
  const dot = path.lastIndexOf(".");
  const extension = dot >= 0 ? path.slice(dot).toLowerCase() : "";
  if (riskyExtensions.has(extension)) signals.push("The file uses an executable or installer extension; do not run it just because it is in this workspace.");

  const sample = new TextDecoder("latin1").decode(bytes.slice(0, Math.min(bytes.byteLength, 2 * 1024 * 1024)));
  if (sample.includes("vbaProject.bin") || /<(?:script|macro|w:macros)/i.test(sample)) {
    signals.push("The file contains a marker associated with macros or executable document content; macro execution is not performed.");
  }
  if (contentType === "application/pdf" && !sample.startsWith("%PDF")) {
    signals.push("The declared PDF type did not have a PDF header; treat the original as untrusted.");
  }
  if ((contentType.includes("zip") || extension === ".zip" || extension === ".docx" || extension === ".xlsx" || extension === ".pptx") && bytes.byteLength >= 4 && !(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    signals.push("The declared package type did not have a ZIP package header; treat the original as untrusted.");
  }

  return {
    status: signals.length > 0 ? "basic-check-warning" : "basic-check-passed",
    scanner: "basic-heuristics-only",
    signals,
    disclaimer: "This is not a malware verdict. It is a small local heuristic check; enhanced scanning is a separate, explicitly priced path.",
  };
}
