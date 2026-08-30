-- The whole record. Five columns, and the email is the identity so a second submission
-- from the same person updates what they do rather than adding a row.
--
-- No IP address column, on purpose: Cloudflare hands the Function CF-Connecting-IP on every
-- request and we choose not to write it down. /privacy describes this table in these terms,
-- so a column added here is a change to a published claim.

CREATE TABLE IF NOT EXISTS interest (
  email           TEXT PRIMARY KEY,
  profession      TEXT NOT NULL,
  -- What they spend too long on, in their own words. Nullable because the rows written
  -- before this column existed were never asked, and NULL says that where an empty string
  -- would look like they had nothing to say. See migrations/001.
  spends_too_long TEXT,
  -- Whether they would expect to buy it once or pay yearly. Free text, because a list would
  -- only offer the two cadences we already thought of. Nullable for the same reason as
  -- above. See migrations/002.
  cadence_expected TEXT,
  at              TEXT NOT NULL
);

-- What the page is a test of: which professions turn up.
CREATE INDEX IF NOT EXISTS interest_by_profession ON interest (profession);
