function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function renderLandingPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Turn files into a temporary, readable workspace and a link you can share with an agent or collaborator. The link expires on the window you choose.">
  <title>Agent File Optimizer</title>
  <link rel="icon" href="data:,">
  <style>
    :root { color-scheme: dark light; --bg:#111318; --panel:#1b1e27; --field:#101218; --line:#3a4152; --edge:#7c869e; --ink:#f4f5f7; --muted:#c3c9d6; --accent:#b9f27c; --accent-ink:#17210f; --accent-soft:#202719; --focus:#ffffff; --warn:#ffd27a; }
    @media (prefers-color-scheme: light) { :root { --bg:#f7f4ee; --panel:#ffffff; --field:#ffffff; --line:#d9d3c7; --edge:#857d6e; --ink:#1f2328; --muted:#4a5159; --accent:#33541e; --accent-ink:#ffffff; --accent-soft:#e8efdc; --focus:#0b4f9c; --warn:#8a5a00; } }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    main { max-width:760px; margin:0 auto; padding:8vh 16px 10vh; }
    .eyebrow { color:var(--accent); letter-spacing:.12em; text-transform:uppercase; font-size:.75rem; font-weight:700; }
    h1 { max-width:600px; font-size:clamp(2.2rem,7vw,4.5rem); line-height:1; letter-spacing:-.04em; margin:16px 0; }
    p { color:var(--muted); max-width:620px; margin:0 0 12px; }
    .card { background:var(--panel); border:1px solid var(--line); border-radius:16px; padding:22px; margin-top:28px; }
    h2 { font-size:1rem; margin:0 0 4px; }
    label { display:block; color:var(--muted); font-size:.92rem; margin:16px 0 7px; }
    .hint { color:var(--muted); font-size:.85rem; }
    select,input,button { width:100%; min-height:44px; border:1px solid var(--edge); border-radius:10px; background:var(--field); color:var(--ink); padding:10px 12px; font:inherit; }
    input:focus-visible, select:focus-visible, button:focus-visible, .drop:focus-within { outline:3px solid var(--focus); outline-offset:2px; }
    .drop-row { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
    .drop { position:relative; display:grid; place-items:center; min-height:120px; text-align:center; border:1px dashed var(--edge); border-radius:12px; padding:18px; cursor:pointer; color:var(--ink); }
    .drop:hover,.drop.is-over { border-color:var(--accent); background:var(--accent-soft); }
    .drop input { position:absolute; width:1px; height:1px; opacity:0; overflow:hidden; pointer-events:none; }
    .drop strong { display:block; }
    .drop span { display:block; color:var(--muted); margin-top:4px; font-size:.9rem; }
    button { margin-top:16px; background:var(--accent); color:var(--accent-ink); border:0; font-weight:700; cursor:pointer; }
    button.secondary { background:transparent; color:var(--ink); border:1px solid var(--edge); margin-top:8px; }
    button:disabled { opacity:.5; cursor:wait; }
    #result { margin-top:18px; color:var(--muted); }
    #result:empty { display:none; }
    #result p { margin:0 0 10px; }
    #result a { color:var(--accent); overflow-wrap:anywhere; }
    .notice { border-left:3px solid var(--warn); padding-left:12px; color:var(--ink); }
    .note { font-size:.88rem; margin-top:16px; }
    .sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
    @media (prefers-reduced-motion: reduce) { * { transition:none !important; animation:none !important; } }
    @media (max-width:560px) { .drop-row { grid-template-columns:1fr; } .card { padding:18px; } }
  </style>
</head>
<body>
<main>
  <div class="eyebrow">Temporary context workspace</div>
  <h1>Give an agent the shape of your files.</h1>
  <p>Add files, a folder, or a public GitHub repository. You get a link that keeps the originals and readable notes, and stops working when the window you choose ends.</p>
  <section class="card" aria-labelledby="steps-title">
    <h2 id="steps-title">1. Add what to share</h2>
    <div class="drop-row" id="dropzone">
      <label class="drop" for="files"><input id="files" type="file" multiple><strong id="file-label">Drop files here</strong><span>or choose files</span></label>
      <label class="drop" for="folder"><input id="folder" type="file" multiple webkitdirectory directory><strong>Choose a folder</strong><span>Relative paths are kept.</span></label>
    </div>
    <label for="repo-url">Or a public GitHub repository</label>
    <input id="repo-url" type="url" inputmode="url" placeholder="https://github.com/owner/repository">

    <h2 style="margin-top:22px">2. Choose what it is for and how long it lasts</h2>
    <label for="intent">What should the handoff help with?</label>
    <select id="intent">
      <option value="agent-understanding">Help an agent understand these files</option>
      <option value="structured-data">Extract structured data</option>
      <option value="token-saving">Save context and tokens</option>
      <option value="share-originals">Share originals with a trusted collaborator</option>
    </select>
    <label for="window">Keep the link working for</label>
    <select id="window"><option value="1">1 hour</option><option value="6" selected>6 hours</option><option value="12">12 hours</option></select>
    <label for="admin-token">Admin token <span class="hint">(only if this deployment asks for one)</span></label>
    <input id="admin-token" type="password" autocomplete="off" placeholder="Leave blank unless required">

    <h2 style="margin-top:22px">3. Create the link</h2>
    <p class="note">Each file keeps its original. Text, Markdown, JSON, CSV/TSV, HTML, basic PDF, ZIP, DOCX, PPTX and XLSX also get readable notes; the handoff lists what could be read. A file that cannot be converted (for example an image) is still included as its original and flagged in the handoff, and no external parser is called unless this deployment enables one.</p>
    <p class="note">The link works for anyone who has it, until it expires or you revoke it. Deletion is attempted when the window ends or you revoke, and retried by a scheduled cleanup. Copies may remain in provider backups or logs. Read <a href="https://github.com/rmichaelthomas/agent-file-optimizer/blob/main/PRIVACY.md" target="_blank" rel="noopener noreferrer">PRIVACY.md</a> for details.</p>
    <button id="go" type="button">Create temporary agent link</button>
    <div id="result" role="status" aria-live="polite"></div>
  </section>
</main>
<script>
  const files = document.querySelector('#files');
  const folder = document.querySelector('#folder');
  const dropzone = document.querySelector('#dropzone');
  const repoUrl = document.querySelector('#repo-url');
  const fileLabel = document.querySelector('#file-label');
  const result = document.querySelector('#result');
  const button = document.querySelector('#go');
  let selectedFiles = [];
  // Holds the created workspace while its content is being added, so a failed step can be retried
  // without losing the link or the upload token. The token exists only in this page's memory.
  let pending = null;

  const el = (tag, text, attributes) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    Object.assign(node, attributes || {});
    return node;
  };

  const readError = async (response, fallback) => {
    try {
      const body = await response.json();
      return body.message || fallback;
    } catch (error) {
      return fallback;
    }
  };

  const rememberFiles = (incoming) => {
    selectedFiles = Array.from(incoming || []);
    fileLabel.textContent = selectedFiles.length ? selectedFiles.length + ' file(s) selected' : 'Drop files here';
  };
  files.addEventListener('change', () => rememberFiles(files.files));
  folder.addEventListener('change', () => rememberFiles(folder.files));
  dropzone.addEventListener('dragover', (event) => { event.preventDefault(); dropzone.classList.add('is-over'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-over'));
  dropzone.addEventListener('drop', (event) => { event.preventDefault(); dropzone.classList.remove('is-over'); rememberFiles(event.dataTransfer.files); });

  const revokeLink = async (created, control) => {
    control.disabled = true;
    try {
      const response = await fetch('/api/workspaces/' + encodeURIComponent(created.id) + '/revoke', { method: 'POST', headers: { authorization: 'Bearer ' + created.uploadToken } });
      const body = await response.json();
      if (!response.ok) { control.disabled = false; result.append(el('p', body.message || 'The link could not be revoked yet. Try again.')); return; }
      pending = null;
      result.replaceChildren(el('p', 'The link is off. The workspace content has been deleted.', { className: 'notice' }));
    } catch (error) {
      control.disabled = false;
      result.append(el('p', 'The link could not be revoked because the connection failed. Try again.'));
    }
  };

  const showLink = (created, message, options) => {
    const copy = el('button', 'Copy link', { type: 'button', className: 'secondary' });
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(created.shareUrl);
        copy.textContent = 'Copied';
      } catch (error) {
        copy.textContent = 'Copy failed. Select the link and copy it.';
      }
    });
    const revoke = el('button', 'Revoke link now', { type: 'button', className: 'secondary' });
    revoke.addEventListener('click', () => revokeLink(created, revoke));
    const children = [
      el('p', message, options && options.warning ? { className: 'notice' } : {}),
      el('p', null),
    ];
    const link = el('a', created.shareUrl, { href: created.shareUrl, target: '_blank', rel: 'noreferrer' });
    children[1].append(link);
    children.push(el('p', 'Expires: ' + new Date(created.expiresAt).toLocaleString()));
    children.push(copy, revoke);
    result.replaceChildren(...children);
  };

  const sendContent = async (created, repository) => {
    if (repository) {
      const response = await fetch('/api/workspaces/' + encodeURIComponent(created.id) + '/import-public-repo', { method: 'POST', headers: { authorization: 'Bearer ' + created.uploadToken, 'content-type': 'application/json' }, body: JSON.stringify({ url: repository }) });
      if (!response.ok) throw Object.assign(new Error(await readError(response, 'The repository could not be added.')), { status: response.status });
      return response.json();
    }
    const form = new FormData();
    for (const file of pending.files) { form.append('file', file, file.name); form.append('path', file.webkitRelativePath || file.name); }
    const response = await fetch(created.uploadUrl, { method: 'POST', headers: { authorization: 'Bearer ' + created.uploadToken }, body: form });
    if (!response.ok) throw Object.assign(new Error(await readError(response, 'The files could not be added.')), { status: response.status });
    return response.json();
  };

  button.addEventListener('click', async () => {
    const repository = repoUrl.value.trim();
    if (!selectedFiles.length && !repository) { result.textContent = 'Choose files, a folder, or a public GitHub repository first.'; return; }
    if (selectedFiles.length && repository) { result.textContent = 'Choose files or a folder, or a repository, not both in one link.'; return; }
    if (repository && !/^https:\\/\\/github\\.com\\/[^/\\s]+\\/[^/\\s]+\\/?$/.test(repository)) { result.textContent = 'Enter a public GitHub repository address, like https://github.com/owner/repository.'; return; }
    button.disabled = true;
    try {
      if (pending && (repository !== pending.repository || selectedFiles !== pending.files)) {
        // The inputs changed after a failed attempt. Turn the old link off so it does not stay live.
        await fetch('/api/workspaces/' + encodeURIComponent(pending.created.id) + '/revoke', { method: 'POST', headers: { authorization: 'Bearer ' + pending.created.uploadToken } }).catch(() => undefined);
        pending = null;
      }
      if (!pending) {
        result.textContent = 'Creating the workspace…';
        const adminToken = document.querySelector('#admin-token').value;
        const createHeaders = { 'content-type': 'application/json' };
        if (adminToken) createHeaders.authorization = 'Bearer ' + adminToken;
        const createdResponse = await fetch('/api/workspaces', { method: 'POST', headers: createHeaders, body: JSON.stringify({ intent: document.querySelector('#intent').value, windowHours: Number(document.querySelector('#window').value) }) });
        if (!createdResponse.ok) throw new Error(await readError(createdResponse, 'Could not create the workspace.'));
        pending = { created: await createdResponse.json(), files: selectedFiles, repository: repository };
      }
      result.textContent = 'Adding your files…';
      const upload = await sendContent(pending.created, pending.repository);
      const created = pending.created;
      pending = null;
      const warnings = upload.warnings && upload.warnings.length ? upload.warnings.join(' ') : 'Readable notes are ready.';
      showLink(created, 'Ready. Share this link with the agent or collaborator. ' + warnings, { warning: Boolean(upload.warnings && upload.warnings.length) });
    } catch (error) {
      if (pending && error.status !== 410) {
        showLink(pending.created, 'The link was created, but adding your content failed: ' + error.message + ' The link shows nothing until content is added. Press the button to try the same content again, or revoke the link.', { warning: true });
      } else {
        pending = null;
        result.textContent = error instanceof Error ? error.message : 'Something went wrong. Try again.';
      }
    } finally {
      button.disabled = false;
      button.textContent = pending ? 'Try adding the content again' : 'Create temporary agent link';
    }
  });
</script>
</body>
</html>`;
}

export { escapeHtml };
