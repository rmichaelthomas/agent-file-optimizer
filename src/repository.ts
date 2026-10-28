import { unzipSync } from "fflate";

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

const textDocument = /\.(?:md|mdx|markdown|txt|rst)$/i;
const maxSelectedFiles = 100;
const maxSelectedFileBytes = 1024 * 1024;
const maxSelectedTotalBytes = 10 * 1024 * 1024;
const maxOfferedFiles = 300;
const maxTreePaths = 5000;

export type RepositoryGroup = "agent" | "orientation" | "manifest" | "tool" | "docs";

export interface RepositoryCandidate {
  path: string;
  size: number;
  group: RepositoryGroup;
  /** Whether the file is selected until the person changes it. */
  checked: boolean;
}

export interface RepositoryScan {
  candidates: RepositoryCandidate[];
  /** Every file path in the repository except vendored and dependency folders. Names only. */
  treePaths: string[];
  treeTruncated: boolean;
  total: number;
}

export class RepositorySelectionError extends Error {
  constructor(message: string, readonly status: 400 | 413 = 400) {
    super(message);
  }
}

const manifestNames = new Set(["package.json", "pyproject.toml", "go.mod", "cargo.toml", "gemfile", "composer.json", "pom.xml", "build.gradle", "deno.json", "requirements.txt"]);
const toolFiles = new Set(["claude.md", "gemini.md", ".cursorrules", ".windsurfrules"]);
const toolFolders = [".cursor/rules/", ".github/instructions/"];
const vendoredSegments = new Set(["node_modules", "vendor", "third_party", "dist", "build", ".git"]);
const secretLike = /(^|\/)(\.env[^/]*|id_rsa[^/]*|id_ed25519[^/]*|[^/]*\.(?:pem|key|p12|pfx|jks|keystore)|credentials[^/]*|secrets?\.[^/]*)$/i;

/** Which group a repository file belongs to, or null when it is never offered. Source, configuration, secrets and vendored code are never offered. */
export function classifyRepositoryPath(path: string): RepositoryGroup | null {
  const lower = path.toLowerCase();
  const segments = lower.split("/");
  const name = segments[segments.length - 1];
  const depth = segments.length - 1;
  if (secretLike.test(lower) || segments.some((part) => vendoredSegments.has(part))) return null;
  if (lower === "llms.txt" || lower === "llms-full.txt" || lower === "docs/llms.txt" || lower === "docs/llms-full.txt") return "agent";
  if (name === "agents.md" && depth <= 3) return "agent";
  if (lower.startsWith("docs/agents/") && textDocument.test(name) && !segments.some((part) => part.startsWith("."))) return "agent";
  if (toolFiles.has(name) && depth <= 3 && (depth === 0 || !name.startsWith("."))) return "tool";
  if (lower === ".github/copilot-instructions.md") return "tool";
  if (toolFolders.some((folder) => lower.startsWith(folder)) && /\.(?:md|mdc|txt)$/.test(name)) return "tool";
  if (segments.some((part) => part.startsWith("."))) return null;
  if (/^(?:readme|architecture|contributing)(?:[._-].*)?$/.test(name) && depth <= 2 && (textDocument.test(name) || !name.includes("."))) return "orientation";
  if (depth === 0 && manifestNames.has(name)) return "manifest";
  if ((lower.startsWith("docs/") || lower.startsWith("doc/")) && textDocument.test(name)) return "docs";
  return null;
}

function stripWrapper(entry: string): string {
  const slash = entry.indexOf("/");
  return slash === -1 ? entry : entry.slice(slash + 1);
}

/** Lists what a GitHub archive offers. GitHub wraps everything in one folder named for the repository and branch; that folder is removed from each path. */
export function scanRepository(archive: Uint8Array): RepositoryScan {
  const found: RepositoryCandidate[] = [];
  const treePaths: string[] = [];
  let total = 0;
  unzipSync(archive, {
    filter: (file) => {
      if (file.name.endsWith("/")) return false;
      total += 1;
      const path = stripWrapper(file.name);
      if (!path || path.split("/").includes("..")) return false;
      if (!path.split("/").some((part) => vendoredSegments.has(part.toLowerCase()))) treePaths.push(path);
      const group = file.originalSize <= maxSelectedFileBytes ? classifyRepositoryPath(path) : null;
      if (group) found.push({ path, size: file.originalSize, group, checked: group === "agent" || group === "orientation" || group === "manifest" });
      return false;
    },
  });
  const rank: Record<RepositoryGroup, number> = { agent: 0, orientation: 1, manifest: 2, tool: 3, docs: 4 };
  found.sort((left, right) => rank[left.group] - rank[right.group] || left.path.split("/").length - right.path.split("/").length || left.path.localeCompare(right.path));
  treePaths.sort((left, right) => left.localeCompare(right));
  return { candidates: found.slice(0, maxOfferedFiles), treePaths: treePaths.slice(0, maxTreePaths), treeTruncated: treePaths.length > maxTreePaths, total };
}

export interface RepositoryFile {
  path: string;
  bytes: Uint8Array;
}

/**
 * Reads the chosen files out of the archive. `wanted` is the person's selection; each path must be one this scan offered, so a request cannot add anything the rules exclude.
 * Without `wanted`, the files checked by default are taken, within the caps.
 */
export function selectRepositoryFiles(archive: Uint8Array, scan: RepositoryScan, wanted?: string[]): RepositoryFile[] {
  const offered = new Map(scan.candidates.map((candidate) => [candidate.path, candidate]));
  let chosen: RepositoryCandidate[];
  if (wanted) {
    chosen = [];
    for (const path of new Set(wanted)) {
      const candidate = offered.get(path);
      if (!candidate) throw new RepositorySelectionError(`"${path}" was not one of the files offered for this repository.`);
      chosen.push(candidate);
    }
    if (chosen.length > maxSelectedFiles) throw new RepositorySelectionError(`Choose at most ${maxSelectedFiles} files.`, 413);
    if (chosen.reduce((sum, candidate) => sum + candidate.size, 0) > maxSelectedTotalBytes) throw new RepositorySelectionError(`The chosen files total more than ${maxSelectedTotalBytes / (1024 * 1024)} MiB. Choose fewer.`, 413);
  } else {
    chosen = [];
    let bytes = 0;
    for (const candidate of scan.candidates.filter((entry) => entry.checked)) {
      if (chosen.length >= maxSelectedFiles || bytes + candidate.size > maxSelectedTotalBytes) continue;
      chosen.push(candidate);
      bytes += candidate.size;
    }
  }
  if (chosen.length === 0) return [];
  const byEntry = new Set(chosen.map((candidate) => candidate.path));
  const unzipped = unzipSync(archive, { filter: (file) => byEntry.has(stripWrapper(file.name)) });
  const files: RepositoryFile[] = [];
  for (const [entry, bytes] of Object.entries(unzipped)) files.push({ path: stripWrapper(entry), bytes });
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

/** A names-only listing of the repository, so a reader can see where the code lives without the code being copied. */
export function repositoryFileList(repository: PublicRepository, branch: string, scan: RepositoryScan): string {
  return [
    `# Files in ${repository.canonicalUrl} (branch ${branch})`,
    "",
    "Paths only. The contents of these files are not part of this workspace unless they are listed elsewhere in it.",
    scan.treeTruncated ? `Only the first ${scan.treePaths.length.toLocaleString("en-US")} paths are listed.` : `${scan.treePaths.length.toLocaleString("en-US")} paths. Dependency and build folders are left out.`,
    "",
    ...scan.treePaths,
    "",
  ].join("\n");
}

export { maxRepositoryBytes };
