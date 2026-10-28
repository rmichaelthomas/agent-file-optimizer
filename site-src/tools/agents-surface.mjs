const SITE = 'https://rmichaelthomas.github.io/agent-file-optimizer/';
const REPO = 'https://github.com/rmichaelthomas/agent-file-optimizer';

const stripTags = (html) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/** Machine-readable summary for assistants: what the project is, its limits, and each measured claim with its conditions. */
export function renderAgentsJson({ claims, formats, faq }) {
  return `${JSON.stringify({
    name: 'Agent File Optimizer',
    summary: 'A self-hosted Cloudflare Worker that turns files into one temporary, readable link for an AI agent or a collaborator. The link stops working when the window (1, 6, or 12 hours) ends or is revoked, and the stored content is deleted. There is no hosted service.',
    site: SITE,
    repository: REPO,
    license: 'Apache-2.0',
    windowsHours: [1, 6, 12],
    limits: [
      'Each file is limited to 10 MiB.',
      'A share link is a bearer link: anyone who has it can read the workspace until it ends.',
      'Not a malware scanner; the basic check is a few heuristics.',
      'No text recognition for scans and images; they are kept as originals.',
      'Private repositories are not supported.',
      'The read-only MCP endpoint is experimental.',
    ],
    formats: formats.map(({ input, gets, status }) => ({ input, status, gets: stripTags(gets) })),
    measuredClaims: claims.map((claim) => ({
      id: claim.id,
      title: claim.title,
      claim: claim.plain.say,
      holdsWhen: claim.plain.holdsWhen,
      doesNotTellYou: claim.plain.doesntTell,
      report: `${SITE}evidence/${claim.evidence.map((file) => file.split('/').pop())[0]}`,
    })),
    questions: faq.map(({ q, a }) => ({ question: q, answer: a })),
    documents: { readme: `${REPO}#readme`, privacy: `${REPO}/blob/main/PRIVACY.md`, agentGuide: `${REPO}/blob/main/docs/AGENT_GUIDE.md` },
  }, null, 2)}\n`;
}
