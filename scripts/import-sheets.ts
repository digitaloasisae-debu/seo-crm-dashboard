/**
 * Command-line version of the dashboard's Import page (Super Admin → Import).
 *
 *   npm run import:sheets -- "Blog Automation - Client Data.xlsx"            preview, nothing saved
 *   npm run import:sheets -- "Blog Automation - Client Data.xlsx" --commit   import
 *
 * Download the Google Sheet with File → Download → Microsoft Excel (.xlsx). Re-running is safe.
 */
import { readFileSync } from "node:fs";
import { db } from "../src/lib/db";
import { importSheet, readWorkbook } from "../src/lib/sheet-import";

async function main() {
  const file = process.argv.slice(2).find((a) => a.endsWith(".xlsx"));
  if (!file) throw new Error('Pass the .xlsx file, e.g. npm run import:sheets -- "Blog Automation - Client Data.xlsx"');
  const buf = readFileSync(file);
  const tabs = await readWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const report = await importSheet(tabs, { commit: process.argv.includes("--commit") });
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
