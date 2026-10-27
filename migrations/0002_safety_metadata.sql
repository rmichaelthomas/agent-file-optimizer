ALTER TABLE source_files ADD COLUMN safety_json TEXT NOT NULL DEFAULT '{"status":"basic-check-passed","scanner":"basic-heuristics-only","signals":[],"disclaimer":"This is not a malware verdict."}';
