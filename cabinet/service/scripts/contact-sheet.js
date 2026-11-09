#!/usr/bin/env node
// Puts a drive run's screenshots on contact sheets, in headless Chromium.
//   contact-sheet.js DIR [PER_SHEET]   writes DIR/sheet-1.png, sheet-2.png, ...
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const dir = path.resolve(process.argv[2] ?? ".");
const per = Number(process.argv[3] ?? 9);
const shots = fs.readdirSync(dir).filter((f) => /^\d+-.*\.png$/.test(f)).sort();
const { chromium } = await import("playwright");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1560, height: 1200 } });
for (let i = 0; i < shots.length; i += per) {
  const cells = shots.slice(i, i + per).map((f) => `<figure><img src="${pathToFileURL(path.join(dir, f)).href}"><figcaption>${f.replace(".png", "")}</figcaption></figure>`);
  const html = `<!doctype html><style>body{margin:0;padding:6px;background:#333;display:grid;grid-template-columns:repeat(3,512px);gap:6px}figure{margin:0}img{width:512px;height:384px;image-rendering:pixelated;display:block}figcaption{color:#fff;font:14px monospace}</style>${cells.join("")}`;
  const file = path.join(dir, `sheet-${i / per + 1}.html`);
  fs.writeFileSync(file, html);
  await page.goto(pathToFileURL(file).href);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: path.join(dir, `sheet-${i / per + 1}.png`), fullPage: true });
  fs.rmSync(file);
}
await browser.close();
console.log(`${Math.ceil(shots.length / per)} sheets in ${dir}`);
