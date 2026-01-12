export interface ParsedPrUrl {
  owner: string;
  repo: string;
  prNumber: number;
}

const PR_URL_REGEX = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/;

export function parsePrUrl(url: string): ParsedPrUrl | null {
  const trimmed = url.trim();
  const match = trimmed.match(PR_URL_REGEX);

  if (!match) {
    return null;
  }

  const [, owner, repo, prNumberStr] = match;
  const prNumber = parseInt(prNumberStr, 10);

  if (isNaN(prNumber) || prNumber <= 0) {
    return null;
  }

  return { owner, repo, prNumber };
}

export function extractPrUrlFromText(text: string): string | null {
  const regex = /https?:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/;
  const match = text.match(regex);
  return match ? match[0] : null;
}
