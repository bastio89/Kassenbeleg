-- Grundschema für Kassenbelege
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE categories (
  id                      SERIAL PRIMARY KEY,
  name                    TEXT NOT NULL,
  parent_id               INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  icon                    TEXT,
  color                   TEXT,
  -- Standard-Garantie (Monate) für Artikel dieser Kategorie; 0 = nicht garantierelevant
  default_warranty_months INTEGER NOT NULL DEFAULT 0,
  sort_order              INTEGER NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX categories_unique_name ON categories (COALESCE(parent_id, 0), lower(name));

CREATE TABLE receipts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  source                TEXT NOT NULL DEFAULT 'web',
  uploaded_by           TEXT,
  -- Originaldatei (unverändert gespeichert)
  original_filename     TEXT,
  file_path             TEXT NOT NULL,
  mime_type             TEXT NOT NULL,
  file_size             INTEGER NOT NULL,
  sha256                TEXT NOT NULL UNIQUE,
  preview_path          TEXT,
  -- Ausgelesene Daten
  merchant              TEXT,
  merchant_address      TEXT,
  purchase_date         DATE,
  purchase_time         TIME,
  total                 NUMERIC(12, 2),
  currency              TEXT NOT NULL DEFAULT 'EUR',
  payment_method        TEXT,
  raw_text              TEXT,
  notes                 TEXT,
  needs_review          BOOLEAN NOT NULL DEFAULT false,
  review_reason         TEXT,
  -- Verarbeitung
  ai_provider           TEXT,
  ai_model              TEXT,
  ai_response           JSONB,
  error                 TEXT,
  attempts              INTEGER NOT NULL DEFAULT 0,
  telegram_chat_id      BIGINT,
  telegram_message_id   INTEGER,
  processing_started_at TIMESTAMPTZ,
  processed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX receipts_status_idx ON receipts (status, created_at);
CREATE INDEX receipts_purchase_date_idx ON receipts (purchase_date);
CREATE INDEX receipts_merchant_trgm ON receipts USING gin (merchant gin_trgm_ops);
CREATE INDEX receipts_raw_text_trgm ON receipts USING gin (raw_text gin_trgm_ops);
CREATE INDEX receipts_notes_trgm ON receipts USING gin (notes gin_trgm_ops);

CREATE TABLE receipt_items (
  id                   SERIAL PRIMARY KEY,
  receipt_id           UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  position             INTEGER NOT NULL DEFAULT 0,
  name                 TEXT NOT NULL,
  quantity             NUMERIC(10, 3) NOT NULL DEFAULT 1,
  unit_price           NUMERIC(12, 2),
  total_price          NUMERIC(12, 2) NOT NULL,
  category_id          INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  -- ai | rule | manual | fallback
  category_source      TEXT,
  -- NULL = keine Garantie verfolgen
  warranty_months      INTEGER,
  warranty_notified_at TIMESTAMPTZ,
  notes                TEXT
);
CREATE INDEX receipt_items_receipt_idx ON receipt_items (receipt_id, position);
CREATE INDEX receipt_items_category_idx ON receipt_items (category_id);
CREATE INDEX receipt_items_name_trgm ON receipt_items USING gin (name gin_trgm_ops);

-- Gelernte Zuordnungen: wird eine Kategorie manuell korrigiert, merkt sich das
-- System den (normalisierten) Artikelnamen und ordnet ihn künftig direkt zu.
CREATE TABLE category_rules (
  id          SERIAL PRIMARY KEY,
  pattern     TEXT NOT NULL UNIQUE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  hits        INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Garantie-Ablaufdatum wird immer aus Kaufdatum + Monaten berechnet
CREATE VIEW warranty_items AS
SELECT
  i.id              AS item_id,
  i.receipt_id,
  i.name,
  i.total_price,
  i.warranty_months,
  i.warranty_notified_at,
  i.category_id,
  r.merchant,
  r.purchase_date,
  (r.purchase_date + make_interval(months => i.warranty_months))::date AS warranty_until
FROM receipt_items i
JOIN receipts r ON r.id = i.receipt_id
WHERE i.warranty_months IS NOT NULL
  AND i.warranty_months > 0
  AND r.purchase_date IS NOT NULL;
