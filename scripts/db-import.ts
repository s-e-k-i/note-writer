// Usage: npm run db:import -- --account <noteAccountId> --file <path-to-exported-json>
//
// Imports a JSON file produced by the app's existing "データベースをダウンロード"
// button (TabDatabase.tsx) directly into note_articles. Idempotent — safe to
// re-run. Does NOT call the Anthropic API and does NOT touch localStorage.
import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
import path from "path";
import { readFileSync } from "fs";
import { importArticles } from "../lib/articlesDbImport";
import type { Article } from "../lib/types";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx === -1 ? undefined : args[idx + 1];
  };
  const account = get("--account");
  const file = get("--file");
  if (!account || !file) {
    console.error("Usage: npm run db:import -- --account <noteAccountId> --file <path-to-json>");
    process.exit(1);
  }
  return { account, file };
}

async function main() {
  const { account, file } = parseArgs();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

  const raw = readFileSync(path.resolve(file), "utf8");
  const articles: Article[] = JSON.parse(raw);
  if (!Array.isArray(articles)) throw new Error("JSON file must contain an array of articles");

  console.log(`Importing ${articles.length} articles for account "${account}" from ${file} ...`);

  const sql = neon(process.env.DATABASE_URL);
  const result = await importArticles(sql, account, articles);

  console.log("--- Import result ---");
  console.log(`inserted: ${result.inserted}`);
  console.log(`updated:  ${result.updated}`);
  console.log(`skipped:  ${articles.length - result.inserted - result.updated}`);
  console.log(`total in DB for this account now: ${result.totalAfter}`);
  if (result.warnings.length > 0) {
    console.log("--- Warnings ---");
    for (const w of result.warnings) console.log(`- ${w}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
