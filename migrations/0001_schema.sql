-- Schéma du tableau de bord de pilotage (Cloudflare D1 / SQLite)
-- Aucune donnée métier ici : le dépôt est public. Les données sont saisies dans l'outil.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,            -- slug : romain, kevin...
  name TEXT NOT NULL,
  org TEXT,
  role TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  token_hash TEXT,                -- SHA-256 de la clé d'accès personnelle
  color TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workstreams (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  icon TEXT,                      -- nom d'icône Phosphor (sans préfixe ph-)
  color TEXT,
  lead TEXT REFERENCES users(id),
  sort INTEGER NOT NULL DEFAULT 0
);

-- Objet générique : tâche, décision, document, jalon, budget, sujet
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('task','decision','document','event','budget','topic')),
  title TEXT NOT NULL,
  body TEXT,                      -- markdown
  status TEXT,
  workstream TEXT REFERENCES workstreams(id),
  owner TEXT REFERENCES users(id),
  priority TEXT DEFAULT 'normale', -- haute | normale | basse
  start_date TEXT,                -- YYYY-MM-DD
  due_date TEXT,                  -- échéance
  decision_date TEXT,             -- date de décision
  effective_date TEXT,            -- date d'application / d'effet
  amount REAL,                    -- € HT
  budget_type TEXT,               -- charge | produit | investissement
  options TEXT,                   -- décisions : options envisagées (markdown)
  outcome TEXT,                   -- décisions : arbitrage retenu
  url TEXT,                       -- lien externe (Drive, Docs...)
  file_key TEXT,                  -- fichier dans R2
  file_name TEXT,
  file_type TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_items_kind ON items(kind);
CREATE INDEX IF NOT EXISTS idx_items_ws ON items(workstream);
CREATE INDEX IF NOT EXISTS idx_items_owner ON items(owner);

CREATE TABLE IF NOT EXISTS links (
  from_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  to_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  PRIMARY KEY (from_id, to_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  author TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  org TEXT,
  role TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  notes TEXT,
  tags TEXT,
  user_id TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  who TEXT,
  action TEXT,
  item_id INTEGER,
  summary TEXT,
  via TEXT                        -- web | mcp
);

-- Paramètres JSON (schéma de structure, nom de projet...)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
