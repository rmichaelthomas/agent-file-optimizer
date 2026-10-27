// Prints a text file to PDF with Chrome: node chrome_pdf.mjs IN.md OUT.pdf
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
const text = readFileSync(process.argv[2], "utf8").replace(/&/g, "&amp;").replace(/</g, "&lt;");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
await page.setContent(`<html><body style="font-family:Helvetica;font-size:12px;width:620px"><pre style="white-space:pre-wrap">${text}</pre></body></html>`);
await page.pdf({ path: process.argv[3], format: "Letter" });
await browser.close();
