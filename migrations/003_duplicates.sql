-- Inhaltliche Duplikaterkennung: derselbe Kassenbon, zweimal fotografiert
ALTER TABLE receipts
  ADD COLUMN duplicate_of UUID REFERENCES receipts(id) ON DELETE SET NULL,
  -- true = Nutzer hat bestätigt, dass es KEIN Duplikat ist (nicht erneut markieren)
  ADD COLUMN duplicate_checked BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX receipts_duplicate_lookup_idx ON receipts (purchase_date, total) WHERE status = 'done';
CREATE INDEX receipts_duplicate_of_idx ON receipts (duplicate_of) WHERE duplicate_of IS NOT NULL;

-- Duplikate sollen keine doppelten Garantie-Einträge erzeugen
CREATE OR REPLACE VIEW warranty_items AS
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
  AND r.purchase_date IS NOT NULL
  AND r.duplicate_of IS NULL;
