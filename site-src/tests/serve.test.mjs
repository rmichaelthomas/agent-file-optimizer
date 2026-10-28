import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../tools/serve.mjs';

test('it serves the site under the project subpath and nothing outside it', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'serve-'));
  mkdirSync(path.join(root, 'evidence'));
  writeFileSync(path.join(root, 'index.html'), '<h1>home</h1>');
  writeFileSync(path.join(root, 'evidence', 'index.html'), '<h1>evidence</h1>');
  writeFileSync(path.join(root, 'note.md'), '# note');
  const { server, url } = await startServer({ root, port: 0 });
  try {
    const get = async (p) => fetch(`${url}${p}`);
    assert.equal((await get('/agent-file-optimizer/')).status, 200);
    assert.match(await (await get('/agent-file-optimizer/evidence/')).text(), /evidence/);
    assert.match((await get('/agent-file-optimizer/note.md')).headers.get('content-type'), /markdown/);
    assert.equal((await get('/')).status, 404);
    assert.equal((await get('/index.html')).status, 404);
    assert.equal((await get('/agent-file-optimizer/../secret')).status, 404);
  } finally {
    server.close();
  }
});
