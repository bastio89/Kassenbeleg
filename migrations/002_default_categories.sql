-- Standard-Kategorien. Können jederzeit in der App erweitert/umbenannt werden.
DO $$
DECLARE
  parent INTEGER;
  cat RECORD;
  sub TEXT;
  n INTEGER := 0;
BEGIN
  FOR cat IN
    SELECT * FROM (VALUES
      (1,  'Lebensmittel',          '🛒', '#16a34a', 0,  ARRAY['Obst & Gemüse','Milchprodukte & Eier','Fleisch, Wurst & Fisch','Brot & Backwaren','Grundnahrungsmittel','Tiefkühlkost','Süßwaren & Snacks','Getränke','Alkohol']),
      (2,  'Drogerie & Körperpflege','🧴', '#db2777', 0,  ARRAY['Körperpflege','Kosmetik','Hygieneartikel','Babybedarf']),
      (3,  'Haushalt',              '🏠', '#0891b2', 0,  ARRAY['Reinigungsmittel','Haushaltswaren','Heimtextilien','Möbel & Einrichtung']),
      (4,  'Elektronik',            '💻', '#4f46e5', 24, ARRAY['Computer & Zubehör','Smartphone & Tablet','TV & Audio','Haushaltsgeräte','Foto & Video','Kabel & Kleinteile']),
      (5,  'Kleidung & Schuhe',     '👕', '#9333ea', 0,  ARRAY['Kleidung','Schuhe','Accessoires']),
      (6,  'Baumarkt & Garten',     '🔨', '#ca8a04', 0,  ARRAY['Werkzeug & Maschinen','Baumaterial','Garten & Pflanzen']),
      (7,  'Restaurant & Café',     '🍽️', '#ea580c', 0,  ARRAY['Restaurant','Café & Bäckerei','Imbiss & Fast Food','Lieferdienst']),
      (8,  'Mobilität',             '🚗', '#475569', 0,  ARRAY['Tanken & Laden','Auto & Werkstatt','ÖPNV & Bahn','Parken','Fahrrad']),
      (9,  'Gesundheit',            '💊', '#dc2626', 0,  ARRAY['Apotheke','Arzt & Therapie','Optiker']),
      (10, 'Freizeit & Hobby',      '🎮', '#0d9488', 0,  ARRAY['Bücher & Medien','Spielwaren','Sport','Veranstaltungen & Ausflüge']),
      (11, 'Haustier',              '🐾', '#a16207', 0,  ARRAY['Tierfutter','Tierbedarf']),
      (12, 'Büro & Schreibwaren',   '✏️', '#2563eb', 0,  ARRAY[]::TEXT[]),
      (13, 'Geschenke',             '🎁', '#e11d48', 0,  ARRAY[]::TEXT[]),
      (14, 'Sonstiges',             '📦', '#6b7280', 0,  ARRAY['Pfand & Rabatte','Gebühren & Service','Nicht zugeordnet'])
    ) AS t(sort, name, icon, color, warranty, subs)
  LOOP
    INSERT INTO categories (name, icon, color, default_warranty_months, sort_order)
    VALUES (cat.name, cat.icon, cat.color, cat.warranty, cat.sort)
    RETURNING id INTO parent;
    n := 0;
    FOREACH sub IN ARRAY cat.subs LOOP
      n := n + 1;
      INSERT INTO categories (name, parent_id, default_warranty_months, sort_order)
      VALUES (sub, parent, cat.warranty, n);
    END LOOP;
  END LOOP;

  -- Langlebige Güter außerhalb von "Elektronik" standardmäßig mit 24 Monaten Gewährleistung
  UPDATE categories SET default_warranty_months = 24
  WHERE name IN ('Möbel & Einrichtung', 'Werkzeug & Maschinen', 'Fahrrad', 'Optiker', 'Sport');
  UPDATE categories SET default_warranty_months = 0
  WHERE name = 'Kabel & Kleinteile';
END $$;
