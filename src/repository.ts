export interface PublicRepository {
  provider: "github";
  owner: string;
  repo: string;
  canonicalUrl: string;
}

export interface PublicRepositoryDownload {
  bytes: Uint8Array;
  path: string;
  contentType: "application/zip";
  sourceUrl: string;
  branch: string;
}

const repoPart = /^[A-Za-z0-9._-]+$/;
const maxRepositoryBytes = 25 * 1024 * 1024;
const allowedGitHubHosts = new Set(["api.github.com", "codeload.github.com", "github.com"]);

async function fetchGitHub(url: string, init: RequestInit, fetcher: typeof fetch): Promise<Response> {
  let current = new URL(url);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    if (!allowedGitHubHosts.has(current.hostname.toLowerCase())) throw new Error("GitHub connector refused a redirect to an unapproved host.");
    const response = await fetcher(current, { ...init, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error("GitHub returned a redirect without a destination.");
    current = new URL(location, current);
  }
  throw new Error("GitHub returned too many redirects.");
}

export function parsePublicRepositoryUrl(input: string): PublicRepository {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("Repository URL must be a valid HTTPS URL."); }
  if (url.protocol !== "https:") throw new Error("Repository URL must use HTTPS.");
  if (url.hostname.toLowerCase() !== "github.com") throw new Error("Only GitHub public repositories are on the current connector allowlist.");
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 2 || !repoPart.test(parts[0]) || !repoPart.test(parts[1].replace(/\.git$/, ""))) throw new Error("URL must point to a public repository, not an issue, pull request, or file.");
  const repo = parts[1].replace(/\.git$/, "");
  return { provider: "github", owner: parts[0], repo, canonicalUrl: `https://github.com/${parts[0]}/${repo}` };
}

async function readLimited(response: Response, limit: number): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limit) throw new Error(`Repository archive exceeds the ${limit / (1024 * 1024)} MiB safety limit.`);
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > limit) throw new Error(`Repository archive exceeds the ${limit / (1024 * 1024)} MiB safety limit.`);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > limit) {
        await reader.cancel("repository archive exceeds the configured limit");
        throw new Error(`Repository archive exceeds the ${limit / (1024 * 1024)} MiB safety limit.`);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function downloadPublicRepository(repository: PublicRepository, fetcher: typeof fetch = fetch): Promise<PublicRepositoryDownload> {
  const metadataResponse = await fetchGitHub(`https://api.github.com/repos/${repository.owner}/${repository.repo}`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "agent-file-optimizer" },
  }, fetcher);
  if (!metadataResponse.ok) throw new Error(`GitHub repository metadata request failed with status ${metadataResponse.status}.`);
  const metadata: unknown = await metadataResponse.json();
  const branch = metadata !== null && typeof metadata === "object" && "default_branch" in metadata && typeof metadata.default_branch === "string" ? metadata.default_branch : null;
  if (!branch) throw new Error("GitHub did not return a default branch for this repository.");
  const archiveUrl = `https://codeload.github.com/${repository.owner}/${repository.repo}/zip/refs/heads/${encodeURIComponent(branch)}`;
  const archiveResponse = await fetchGitHub(archiveUrl, { headers: { accept: "application/zip", "user-agent": "agent-file-optimizer" } }, fetcher);
  if (!archiveResponse.ok) throw new Error(`GitHub repository archive request failed with status ${archiveResponse.status}.`);
  const bytes = await readLimited(archiveResponse, maxRepositoryBytes);
  return {
    bytes,
    path: `${repository.repo}.zip`,
    contentType: "application/zip",
    sourceUrl: repository.canonicalUrl,
    branch,
  };
}

export { maxRepositoryBytes };
