-- Dernière connexion de chaque membre (web ou Claude)
ALTER TABLE users ADD COLUMN last_seen TEXT;
ALTER TABLE users ADD COLUMN last_seen_via TEXT;
