export interface OpenDocsGithubRepoStats {
  stargazersCount: number;
  fetchedAt: number;
  stale: boolean;
}

export interface OpenDocsGithubLatestReleaseInfo {
  tagName: string;
  htmlUrl: string;
  fetchedAt: number;
  stale: boolean;
}

export interface OpenDocsDiscordPresence {
  onlineCount: number;
  memberCount: number;
  fetchedAt: number;
  stale: boolean;
}

export interface OpenDocsPublicMetadataService {
  readGithubRepoStats(): Promise<OpenDocsGithubRepoStats>;
  readLatestReleaseInfo(): Promise<OpenDocsGithubLatestReleaseInfo>;
  readDiscordPresence(): Promise<OpenDocsDiscordPresence>;
}

interface CachedGithubRepoStats {
  stargazersCount: number;
  fetchedAt: number;
}

interface CachedGithubLatestReleaseInfo {
  tagName: string;
  htmlUrl: string;
  fetchedAt: number;
}

interface CachedDiscordPresence {
  onlineCount: number;
  memberCount: number;
  fetchedAt: number;
}

interface GithubRepoMetadataPayload {
  stargazers_count?: unknown;
}

interface GithubLatestReleasePayload {
  tag_name?: unknown;
  html_url?: unknown;
}

interface DiscordInviteProfilePayload {
  online_count?: unknown;
  member_count?: unknown;
}

interface DiscordInvitePayload {
  approximate_presence_count?: unknown;
  approximate_member_count?: unknown;
  profile?: unknown;
}

export interface OpenDocsPublicMetadataServiceOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const OPEN_DESIGN_GITHUB_REPO_API = 'https://api.github.com/repos/jhy0285/monofield';
const OPEN_DESIGN_GITHUB_REPO_WEB_URL = 'https://github.com/jhy0285/monofield';
const OPEN_DESIGN_GITHUB_RELEASE_LATEST_API = 'https://api.github.com/repos/jhy0285/monofield/releases/latest';
const OPEN_DESIGN_GITHUB_CACHE_TTL_MS = 60 * 60 * 1000;
const OPEN_DESIGN_GITHUB_TIMEOUT_MS = 4_000;
const OPEN_DESIGN_DISCORD_INVITE_CODE = '9ptkbbqRu';
export const OPEN_DESIGN_DISCORD_INVITE_URL = `https://discord.gg/${OPEN_DESIGN_DISCORD_INVITE_CODE}`;
const OPEN_DESIGN_DISCORD_INVITE_API = `https://discord.com/api/v10/invites/${OPEN_DESIGN_DISCORD_INVITE_CODE}?with_counts=true`;
const OPEN_DESIGN_DISCORD_CACHE_TTL_MS = 5 * 60 * 1000;
const OPEN_DESIGN_DISCORD_TIMEOUT_MS = 4_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readFiniteNonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function readGithubToken(): string | null {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  return token && token.trim() ? token.trim() : null;
}

function githubHeaders(accept: string): Record<string, string> {
  const headers: Record<string, string> = {
    accept,
    'user-agent': 'open-design-daemon',
  };
  const token = readGithubToken();
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function readAttribute(tag: string, attribute: string): string | null {
  const pattern = new RegExp(`\\b${attribute}=(["'])(.*?)\\1`, 'i');
  const match = tag.match(pattern);
  return match ? decodeHtmlAttribute(match[2] ?? '') : null;
}

function parseGithubCountLabel(label: string): number | null {
  const normalized = label.trim().replace(/,/g, '').replace(/\s+/g, '');
  const match = normalized.match(/^(\d+(?:\.\d+)?)([kKmM])?$/);
  if (!match) return null;
  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  const suffix = match[2]?.toLowerCase();
  const multiplier = suffix === 'm' ? 1_000_000 : suffix === 'k' ? 1_000 : 1;
  return Math.round(numeric * multiplier);
}

function readGithubStarsFromHtml(html: string): number | null {
  const tag = html.match(/<span\b[^>]*\bid=["']repo-stars-counter-star["'][^>]*>/i)?.[0];
  if (!tag) return null;
  const titleCount = readAttribute(tag, 'title');
  if (titleCount) {
    const parsed = parseGithubCountLabel(titleCount);
    if (parsed != null) return parsed;
  }
  const ariaLabel = readAttribute(tag, 'aria-label');
  const ariaCount = ariaLabel?.match(/^([\d.,]+(?:\s*[kKmM])?)/)?.[1];
  return ariaCount ? parseGithubCountLabel(ariaCount) : null;
}

function withFreshness<T extends { fetchedAt: number }>(
  value: T,
  stale: boolean,
): T & { stale: boolean } {
  return { ...value, stale };
}

export function createOpenDocsPublicMetadataService({
  fetchImpl = fetch,
  now = () => Date.now(),
}: OpenDocsPublicMetadataServiceOptions = {}): OpenDocsPublicMetadataService {
  let githubRepoCache: CachedGithubRepoStats | null = null;
  let githubRepoInflight: Promise<OpenDocsGithubRepoStats> | null = null;
  let githubLatestReleaseCache: CachedGithubLatestReleaseInfo | null = null;
  let githubLatestReleaseInflight: Promise<OpenDocsGithubLatestReleaseInfo> | null = null;
  let discordPresenceCache: CachedDiscordPresence | null = null;
  let discordPresenceInflight: Promise<OpenDocsDiscordPresence> | null = null;

  async function readGithubRepoStatsFromHtml(): Promise<CachedGithubRepoStats> {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), OPEN_DESIGN_GITHUB_TIMEOUT_MS);
    try {
      const response = await fetchImpl(OPEN_DESIGN_GITHUB_REPO_WEB_URL, {
        headers: githubHeaders('text/html'),
        signal: ctrl.signal,
      });
      if (!response.ok) {
        throw new Error(`GitHub repo page request failed with HTTP ${response.status}`);
      }
      const html = await response.text();
      const stargazersCount = readGithubStarsFromHtml(html);
      if (stargazersCount == null) {
        throw new Error('GitHub repo page did not include a readable star count');
      }
      return { stargazersCount, fetchedAt: now() };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function readGithubRepoStats(): Promise<OpenDocsGithubRepoStats> {
    const currentTime = now();
    if (
      githubRepoCache &&
      currentTime - githubRepoCache.fetchedAt < OPEN_DESIGN_GITHUB_CACHE_TTL_MS
    ) {
      return withFreshness(githubRepoCache, false);
    }

    if (githubRepoInflight) return githubRepoInflight;

    githubRepoInflight = (async () => {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), OPEN_DESIGN_GITHUB_TIMEOUT_MS);
      try {
        const response = await fetchImpl(OPEN_DESIGN_GITHUB_REPO_API, {
          headers: githubHeaders('application/vnd.github+json'),
          signal: ctrl.signal,
        });
        if (!response.ok) {
          throw new Error(`GitHub repo metadata request failed with HTTP ${response.status}`);
        }
        const payload = (await response.json()) as GithubRepoMetadataPayload;
        const stargazersCount = readFiniteNonNegativeNumber(payload.stargazers_count);
        if (stargazersCount == null) {
          throw new Error('GitHub repo metadata did not include a numeric stargazers_count');
        }
        githubRepoCache = { stargazersCount, fetchedAt: now() };
        return withFreshness(githubRepoCache, false);
      } catch (error) {
        try {
          githubRepoCache = await readGithubRepoStatsFromHtml();
          return withFreshness(githubRepoCache, false);
        } catch {
          // If both live sources fail, keep the last known value visibly stale.
        }
        if (githubRepoCache) return withFreshness(githubRepoCache, true);
        throw error;
      } finally {
        clearTimeout(timeout);
        githubRepoInflight = null;
      }
    })();

    return githubRepoInflight;
  }

  async function readLatestReleaseInfo(): Promise<OpenDocsGithubLatestReleaseInfo> {
    const currentTime = now();
    if (
      githubLatestReleaseCache &&
      currentTime - githubLatestReleaseCache.fetchedAt < OPEN_DESIGN_GITHUB_CACHE_TTL_MS
    ) {
      return withFreshness(githubLatestReleaseCache, false);
    }

    if (githubLatestReleaseInflight) return githubLatestReleaseInflight;

    githubLatestReleaseInflight = (async () => {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), OPEN_DESIGN_GITHUB_TIMEOUT_MS);
      try {
        const response = await fetchImpl(OPEN_DESIGN_GITHUB_RELEASE_LATEST_API, {
          headers: githubHeaders('application/vnd.github+json'),
          signal: ctrl.signal,
        });
        if (!response.ok) {
          throw new Error(`GitHub latest release request failed with HTTP ${response.status}`);
        }
        const payload = (await response.json()) as GithubLatestReleasePayload;
        const tagName = typeof payload.tag_name === 'string' ? payload.tag_name : null;
        const htmlUrl = typeof payload.html_url === 'string' ? payload.html_url : null;
        if (!tagName || !htmlUrl) {
          throw new Error('GitHub latest release metadata did not include tag_name/html_url');
        }
        githubLatestReleaseCache = { tagName, htmlUrl, fetchedAt: now() };
        return withFreshness(githubLatestReleaseCache, false);
      } catch (error) {
        if (githubLatestReleaseCache) return withFreshness(githubLatestReleaseCache, true);
        throw error;
      } finally {
        clearTimeout(timeout);
        githubLatestReleaseInflight = null;
      }
    })();

    return githubLatestReleaseInflight;
  }

  async function readDiscordPresence(): Promise<OpenDocsDiscordPresence> {
    const currentTime = now();
    if (
      discordPresenceCache &&
      currentTime - discordPresenceCache.fetchedAt < OPEN_DESIGN_DISCORD_CACHE_TTL_MS
    ) {
      return withFreshness(discordPresenceCache, false);
    }

    if (discordPresenceInflight) return discordPresenceInflight;

    discordPresenceInflight = (async () => {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), OPEN_DESIGN_DISCORD_TIMEOUT_MS);
      try {
        const response = await fetchImpl(OPEN_DESIGN_DISCORD_INVITE_API, {
          headers: {
            accept: 'application/json',
            'user-agent': 'open-design-daemon',
          },
          signal: ctrl.signal,
        });
        if (!response.ok) {
          throw new Error(`Discord invite metadata request failed with HTTP ${response.status}`);
        }
        const payload = (await response.json()) as DiscordInvitePayload;
        const profile = isObject(payload.profile)
          ? (payload.profile as DiscordInviteProfilePayload)
          : null;
        const onlineCount =
          readFiniteNonNegativeNumber(payload.approximate_presence_count) ??
          readFiniteNonNegativeNumber(profile?.online_count);
        const memberCount =
          readFiniteNonNegativeNumber(payload.approximate_member_count) ??
          readFiniteNonNegativeNumber(profile?.member_count);

        if (onlineCount == null || memberCount == null) {
          throw new Error('Discord invite metadata did not include numeric member counts');
        }

        discordPresenceCache = { onlineCount, memberCount, fetchedAt: now() };
        return withFreshness(discordPresenceCache, false);
      } catch (error) {
        if (discordPresenceCache) return withFreshness(discordPresenceCache, true);
        throw error;
      } finally {
        clearTimeout(timeout);
        discordPresenceInflight = null;
      }
    })();

    return discordPresenceInflight;
  }

  return {
    readGithubRepoStats,
    readLatestReleaseInfo,
    readDiscordPresence,
  };
}
