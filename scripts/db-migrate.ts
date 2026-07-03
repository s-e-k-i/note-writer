import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set (run `vercel env pull .env.local` first)");
}

const sql = neon(process.env.DATABASE_URL);

async function migrate() {
  // note_articles: server-side record for note-writer's article database.
  // This table is NOT yet the primary storage for the app (Phase 0/1) —
  // localStorage remains authoritative until Phase 2 explicitly switches over.
  await sql`
    CREATE TABLE IF NOT EXISTS note_articles (
      id              BIGSERIAL PRIMARY KEY,
      note_account_id TEXT NOT NULL,

      -- Identifiers carried over from the localStorage-era Article record.
      -- legacy_id is the original Article.id (e.g. "001"); it is only unique
      -- *within* a single note account, never globally (see number below).
      legacy_id       TEXT,
      -- Deterministic fallback identifier computed at import time, used when
      -- legacy_id is missing/unreliable (e.g. future non-JSON import sources).
      legacy_key      TEXT,
      number          INTEGER,

      title           TEXT NOT NULL,
      body            TEXT,
      -- sha256 of the full body text, captured at import time so later
      -- verification can confirm no truncation/corruption occurred.
      body_hash       TEXT,

      summary         TEXT NOT NULL DEFAULT '',
      summary_status  TEXT CHECK (summary_status IS NULL OR summary_status IN ('generating', 'done', 'failed')),

      url             TEXT,
      is_paid         BOOLEAN NOT NULL DEFAULT FALSE,
      paid_price      INTEGER,
      magazine        TEXT,
      magazines       TEXT[],

      -- No equivalent field exists in the current client Article type.
      -- Left NULL for migrated rows rather than guessing a value.
      status          TEXT,
      -- Populated only from the legacy date field (a real publish date),
      -- never fabricated.
      published_at    DATE,

      -- created_at/updated_at reflect when the row entered THIS database,
      -- not when the article was originally written or published.
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      version         INTEGER NOT NULL DEFAULT 1,
      deleted_at      TIMESTAMPTZ,

      -- Client-generated write timestamp (Date.now(), ms) from the browser's
      -- dual-write mirror. Only set by the live mirror path, never by the
      -- CLI migration/import tooling. Used to reject a stale mirror write
      -- that arrives after a newer one due to network reordering — see
      -- lib/articlesDbImport.ts's ON CONFLICT ... WHERE guard.
      mirror_seq      BIGINT,

      -- Primary idempotency guard for migration/import: a given account's
      -- legacy id must map to exactly one row.
      UNIQUE (note_account_id, legacy_id)
    )
  `;

  await sql`ALTER TABLE note_articles ADD COLUMN IF NOT EXISTS mirror_seq BIGINT`;

  await sql`
    CREATE INDEX IF NOT EXISTS note_articles_account_idx
      ON note_articles (note_account_id)
      WHERE deleted_at IS NULL
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS note_articles_account_number_idx
      ON note_articles (note_account_id, number)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS note_articles_legacy_key_idx
      ON note_articles (note_account_id, legacy_key)
  `;

  console.log("Migration completed: note_articles table is ready.");
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
