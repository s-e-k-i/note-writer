// Usage: npm run db:verify -- --account <noteAccountId> --file <path-to-exported-json>
//
// Compares a JSON export (source of truth today) against what's actually in
// note_articles for that account. Read-only — makes no writes, no Anthropic
// calls. Report only; does not change the app's storage source.
import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
import path from "path";
import { readFileSync } from "fs";
import type { Article } from "../lib/types";
import { sha256, type DbArticleRow } from "../lib/articlesDb";

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
    console.error("Usage: npm run db:verify -- --account <noteAccountId> --file <path-to-json>");
    process.exit(1);
  }
  return { account, file };
}

async function main() {
  const { account, file } = parseArgs();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

  const raw = readFileSync(path.resolve(file), "utf8");
  const jsonArticles: Article[] = JSON.parse(raw);
  if (!Array.isArray(jsonArticles)) throw new Error("JSON file must contain an array of articles");

  const sql = neon(process.env.DATABASE_URL);
  // published_at is cast to text in SQL (not left as a JS Date object) —
  // the neon driver parses DATE columns as local-midnight Date objects,
  // which then serialize as a UTC timestamp one day off from the literal
  // calendar date. Casting server-side avoids that JS-side artifact.
  const dbRows = (await sql`
    SELECT *, published_at::text AS published_at FROM note_articles
    WHERE note_account_id = ${account} AND deleted_at IS NULL
  `) as DbArticleRow[];

  console.log(`JSON count: ${jsonArticles.length}`);
  console.log(`DB count:   ${dbRows.length}`);

  const dbByLegacyId = new Map(dbRows.map((r) => [r.legacy_id, r]));
  const mismatches: string[] = [];
  const missingInDb: string[] = [];

  for (const a of jsonArticles) {
    const row = dbByLegacyId.get(a.id);
    if (!row) {
      missingInDb.push(`legacy_id=${a.id} title="${a.title}" がDBに見つかりません`);
      continue;
    }
    const jsonBody = a.body ?? "";
    const jsonBodyHash = jsonBody ? sha256(jsonBody) : null;
    const checks: [string, unknown, unknown][] = [
      ["number", a.number ?? null, row.number],
      ["title", a.title, row.title],
      ["body length", jsonBody.length, (row.body ?? "").length],
      ["body hash", jsonBodyHash, row.body_hash],
      ["summary", a.summary ?? "", row.summary],
      ["url", a.url ?? null, row.url ?? null],
      ["is_paid", a.isPaid ?? false, row.is_paid],
      ["published_at", a.date ?? null, row.published_at],
    ];
    for (const [field, jsonVal, dbVal] of checks) {
      if (String(jsonVal ?? "") !== String(dbVal ?? "")) {
        mismatches.push(`legacy_id=${a.id} title="${a.title}": ${field} 不一致 (JSON=${JSON.stringify(jsonVal)}, DB=${JSON.stringify(dbVal)})`);
      }
    }
  }

  const jsonIds = new Set(jsonArticles.map((a) => a.id));
  const extraInDb = dbRows.filter((r) => !jsonIds.has(r.legacy_id ?? "")).map((r) => `legacy_id=${r.legacy_id} title="${r.title}" はDBのみに存在します（JSONに無し）`);

  console.log(`\n--- Missing in DB (${missingInDb.length}) ---`);
  missingInDb.forEach((m) => console.log(`- ${m}`));

  console.log(`\n--- Extra in DB, not in JSON (${extraInDb.length}) ---`);
  extraInDb.forEach((m) => console.log(`- ${m}`));

  console.log(`\n--- Field mismatches (${mismatches.length}) ---`);
  mismatches.forEach((m) => console.log(`- ${m}`));

  const ok = missingInDb.length === 0 && extraInDb.length === 0 && mismatches.length === 0;
  console.log(`\nResult: ${ok ? "OK — full match" : "MISMATCHES FOUND — do not switch storage over yet"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
