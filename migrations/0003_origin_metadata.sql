ALTER TABLE source_files ADD COLUMN origin_json TEXT NOT NULL DEFAULT '{"kind":"upload"}';
