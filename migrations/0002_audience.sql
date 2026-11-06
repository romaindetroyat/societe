-- Visibilité restreinte : liste d'identifiants séparés par des virgules (NULL = visible par tous)
ALTER TABLE items ADD COLUMN audience TEXT;
