import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** site-src/: the source of the public site. The deployed directory is site/ (see OUT_DIR). */
export const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REPO_ROOT = path.dirname(SOURCE_ROOT);
export const SRC_DIR = path.join(SOURCE_ROOT, 'src');
/** What GitHub Pages publishes (pages.yml uploads this directory). Generated files are committed. */
export const OUT_DIR = path.join(REPO_ROOT, 'site');
