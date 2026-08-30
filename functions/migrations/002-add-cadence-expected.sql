-- Adds the fourth answer: whether they would expect to buy this once or pay yearly.
--
-- It is a column rather than something appended to the free text because the whole reason
-- for asking is to count the answers, and a value you have to read prose to extract is not
-- one you will count. Free text all the same: no list, because a list would offer only the
-- two cadences we already thought of and "per matter" or "per seat when we hire" are
-- exactly the answers worth hearing.
--
-- Nullable, like spends_too_long, so the rows written before the question existed read as
-- never asked rather than as no opinion.
--
-- Run against the live database:
--   npx wrangler d1 execute pdf-iq-interest --remote --file functions/migrations/002-add-cadence-expected.sql
--
-- Not idempotent: SQLite has no ADD COLUMN IF NOT EXISTS. Running it twice errors with
-- "duplicate column name", which changes nothing.

ALTER TABLE interest ADD COLUMN cadence_expected TEXT;
