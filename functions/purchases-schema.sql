-- Pro purchases: the whole record the entitlement check reads.
--
-- Its own database, bound to the Functions as PURCHASES, and never the interest database. Preview
-- binds a sandbox database and Production a live one, so a sandbox test purchase cannot exist in
-- the table production reads. Keeping them apart by binding makes that structural rather than a
-- column someone has to remember to filter on.
--
-- What is NOT here, on purpose: no card data, no billing address, no amount, no IP address. Paddle
-- holds payment details as merchant of record; Cloudflare hands us CF-Connecting-IP and we choose
-- not to write it down, as with the interest form. /privacy will describe this table in these
-- terms, so a column added here is a change to a published claim.
--
-- Create it (sandbox first):
--   npx wrangler d1 execute pdf-iq-purchases-sandbox --remote --file functions/purchases-schema.sql
-- or paste this file into the database's console in the Cloudflare dashboard.

CREATE TABLE IF NOT EXISTS purchases (
  -- Paddle's transaction id (txn_…). One row per purchase.
  transaction_id TEXT PRIMARY KEY,
  -- The Firebase uid that bought it, from the checkout's custom_data. NULL when an adjustment
  -- arrived before the purchase itself, or a checkout carried no custom_data; the purchase is
  -- then kept and bound when the completed transaction or a support request supplies it.
  uid            TEXT,
  -- The signed-in Google email at checkout, from custom_data. The fallback when an account is
  -- deleted and re-created: the same Google account comes back with a new uid, and /privacy
  -- promises that deleting an account does not revoke Pro.
  email          TEXT,
  -- 'granted' or 'revoked'. Revoked by an approved full refund or a chargeback; granted again
  -- by a chargeback reversal.
  status         TEXT NOT NULL CHECK (status IN ('granted', 'revoked')),
  -- occurred_at of the event that set status. An older event never overwrites a newer one:
  -- Paddle retries for three days, so deliveries can arrive out of order.
  changed_at     TEXT NOT NULL,
  -- The last Paddle event applied (evt_…). A repeat delivery of it changes nothing.
  last_event_id  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS purchases_by_uid ON purchases (uid);
CREATE INDEX IF NOT EXISTS purchases_by_email ON purchases (email);
