-- ITAD lot valuation + live auction tables (Cloudflare D1).
-- Apply with:  npx wrangler d1 migrations apply recovery-index-itad --remote

CREATE TABLE IF NOT EXISTS lots (
  id TEXT PRIMARY KEY,
  ref TEXT UNIQUE NOT NULL,              -- short reference shown to the client, e.g. RI-7KQ2M
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted', -- submitted | inspecting | ready | auction | sold | withdrawn
  company TEXT, contact TEXT, email TEXT, phone TEXT, city TEXT, address TEXT, gstin TEXT,
  file_name TEXT,
  rows_json TEXT,                        -- the client's sheet as uploaded (array of rows)
  assets_json TEXT,                      -- parsed assets incl. inspector overrides
  units INTEGER, est_lo INTEGER, est_hi INTEGER,
  upload_token_hash TEXT,                -- lets the client's browser attach photos right after submitting
  notes TEXT
);

CREATE TABLE IF NOT EXISTS photos (
  key TEXT PRIMARY KEY,                  -- R2 object key
  lot_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  content_type TEXT,
  row_no INTEGER,                        -- sheet row the photo was matched to, if any
  ai_json TEXT                           -- AI grading result, if run
);
CREATE INDEX IF NOT EXISTS photos_lot ON photos(lot_id);

CREATE TABLE IF NOT EXISTS buyers (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  company TEXT NOT NULL, contact TEXT, email TEXT, phone TEXT, city TEXT, gstin TEXT,
  category TEXT,                         -- itad | refurbisher | recycler | trader
  authorisation TEXT,                    -- CPCB/SPCB authorisation or registration number
  alias TEXT,                            -- anonymous name shown to other bidders, e.g. "Bidder 14"
  token_hash TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS buyers_token ON buyers(token_hash);

CREATE TABLE IF NOT EXISTS auctions (
  id TEXT PRIMARY KEY,
  lot_id TEXT NOT NULL,
  title TEXT NOT NULL,
  city TEXT,
  created_at INTEGER NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,             -- scheduled close; each sub-lot can extend on late bids
  soft_close_sec INTEGER NOT NULL DEFAULT 120,
  status TEXT NOT NULL DEFAULT 'scheduled' -- scheduled | ended | cancelled
);

CREATE TABLE IF NOT EXISTS sublots (
  id TEXT PRIMARY KEY,
  auction_id TEXT NOT NULL,
  label TEXT NOT NULL,
  bucket TEXT,
  units INTEGER, est_lo INTEGER, est_hi INTEGER,
  opening INTEGER NOT NULL, reserve INTEGER NOT NULL, increment INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  items_json TEXT
);
CREATE INDEX IF NOT EXISTS sublots_auction ON sublots(auction_id);

CREATE TABLE IF NOT EXISTS bids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sublot_id TEXT NOT NULL,
  buyer_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS bids_sublot ON bids(sublot_id, amount DESC);

CREATE TABLE IF NOT EXISTS grade_log (
  ip TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, day)
);
