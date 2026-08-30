-- The whole record. Three columns, and the email is the identity so a second submission
-- from the same person updates what they do rather than adding a row.
--
-- No IP address column, on purpose: Cloudflare hands the Function CF-Connecting-IP on every
-- request and we choose not to write it down. /privacy describes this table in these terms,
-- so a column added here is a change to a published claim.

CREATE TABLE IF NOT EXISTS interest (
  email      TEXT PRIMARY KEY,
  profession TEXT NOT NULL,
  at         TEXT NOT NULL
);

-- What the page is a test of: which professions turn up.
CREATE INDEX IF NOT EXISTS interest_by_profession ON interest (profession);
