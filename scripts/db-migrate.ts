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

  // research_posts: master record of an external X post captured via the
  // Chrome extension (research/x-research-extension/). Not tied to any note
  // account by itself — the same post can be referenced by multiple accounts
  // via research_post_accounts below. See docs/x-research-db-and-persona-
  // design.md (section 7) for the full design rationale.
  await sql`
    CREATE TABLE IF NOT EXISTS research_posts (
      id                BIGSERIAL PRIMARY KEY,

      -- Reserved for future non-X platforms (e.g. Threads). Server-controlled;
      -- Phase 1 only ever writes 'x' here (never trust client input for this).
      platform          TEXT NOT NULL DEFAULT 'x',
      -- X's post id. Exceeds JS's safe integer range, so this is TEXT, never
      -- a numeric column.
      post_id           TEXT NOT NULL,

      url               TEXT NOT NULL,
      author_name       TEXT,
      author_handle     TEXT NOT NULL,
      text              TEXT,
      is_text_truncated BOOLEAN NOT NULL DEFAULT FALSE,

      -- Chrome extension's postedAtRaw (ISO datetime), stored verbatim with
      -- no JST conversion at write time. JST conversion happens only at
      -- display time, in the UI.
      posted_at         TIMESTAMPTZ,

      -- Engagement counts. NULL means "not captured this time", distinct
      -- from an actual 0. Never coerce a missing count to 0.
      replies           INTEGER,
      reposts           INTEGER,
      likes             INTEGER,
      bookmarks         INTEGER,
      views             INTEGER,

      -- When note-writer most recently imported/refreshed this row (not
      -- when the post was originally published — see posted_at for that).
      captured_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

      -- Primary idempotency guard: the same real-world post is never
      -- duplicated, regardless of how many note accounts reference it.
      UNIQUE (platform, post_id)
    )
  `;

  // research_post_accounts: which note account(s) use a given research_posts
  // row, plus per-account fields (saved_reason/memo/tags/search_query) that
  // must never be clobbered by re-importing the same JSON. Deleting a row
  // here only removes that one account's association — it never deletes the
  // underlying research_posts row (Phase 1 implements no delete path for
  // research_posts itself; orphaned rows are left in place by design).
  await sql`
    CREATE TABLE IF NOT EXISTS research_post_accounts (
      id                BIGSERIAL PRIMARY KEY,
      research_post_id  BIGINT NOT NULL REFERENCES research_posts(id) ON DELETE CASCADE,
      note_account_id   TEXT NOT NULL,

      saved_reason      TEXT,
      memo              TEXT,
      tags              TEXT[],
      -- Optional, entered by hand at import time (the Chrome extension JSON
      -- itself carries no search_query field).
      search_query      TEXT,

      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

      -- A given post is associated with a given note account at most once.
      UNIQUE (research_post_id, note_account_id)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS research_post_accounts_account_idx
      ON research_post_accounts (note_account_id)
  `;

  console.log("Migration completed: research_posts / research_post_accounts tables are ready.");
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
