-- Adds the third field: what the person spends too long on, in their own words.
--
-- The table already has real rows, so this is an ALTER rather than a change to schema.sql
-- alone. SQLite's ADD COLUMN is safe here because the column is nullable: existing rows get
-- NULL, which is honest — those people were never asked the question, and NULL says that
-- where an empty string would look like they had nothing to say.
--
-- Run against the live database:
--   npx wrangler d1 execute pdf-iq-interest --remote --file functions/migrations/001-add-spends-too-long.sql
--
-- Idempotent it is not: SQLite has no ADD COLUMN IF NOT EXISTS. Running it twice errors
-- with "duplicate column name", which is a safe failure — it changes nothing.

ALTER TABLE interest ADD COLUMN spends_too_long TEXT;
