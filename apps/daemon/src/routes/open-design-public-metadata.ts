import type { Express } from 'express';
import type {
  OpenDocsDiscordPresenceResponse,
  OpenDocsGithubLatestReleaseResponse,
  OpenDocsGithubRepoResponse,
} from '@open-design/contracts';
import type { RouteDeps } from '../server-context.js';
import {
  OPEN_DESIGN_DISCORD_INVITE_URL,
  type OpenDocsPublicMetadataService,
} from '../services/open-design-public-metadata.js';

export interface RegisterOpenDocsPublicMetadataRoutesDeps extends RouteDeps<'http'> {
  openDocsPublicMetadata: OpenDocsPublicMetadataService;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function registerOpenDocsPublicMetadataRoutes(
  app: Express,
  ctx: RegisterOpenDocsPublicMetadataRoutesDeps,
): void {
  const { openDocsPublicMetadata } = ctx;

  app.get('/api/github/open-docs', async (_req, res) => {
    try {
      const stats = await openDocsPublicMetadata.readGithubRepoStats();
      const payload: OpenDocsGithubRepoResponse = {
        repo: 'jhy0285/monofield',
        stargazers_count: stats.stargazersCount,
        fetchedAt: stats.fetchedAt,
        stale: stats.stale,
      };
      res.json(payload);
    } catch (error) {
      res.status(502).json({ error: errorMessage(error) });
    }
  });

  app.get('/api/github/open-docs/releases/latest', async (_req, res) => {
    try {
      const release = await openDocsPublicMetadata.readLatestReleaseInfo();
      const payload: OpenDocsGithubLatestReleaseResponse = {
        repo: 'jhy0285/monofield',
        tag_name: release.tagName,
        html_url: release.htmlUrl,
        fetchedAt: release.fetchedAt,
        stale: release.stale,
      };
      res.json(payload);
    } catch (error) {
      res.status(502).json({ error: errorMessage(error) });
    }
  });

  app.get('/api/community/discord', async (_req, res) => {
    try {
      const presence = await openDocsPublicMetadata.readDiscordPresence();
      const payload: OpenDocsDiscordPresenceResponse = {
        inviteCode: '9ptkbbqRu',
        inviteUrl: OPEN_DESIGN_DISCORD_INVITE_URL,
        onlineCount: presence.onlineCount,
        memberCount: presence.memberCount,
        fetchedAt: presence.fetchedAt,
        stale: presence.stale,
      };
      res.json(payload);
    } catch {
      const payload: OpenDocsDiscordPresenceResponse = {
        inviteCode: '9ptkbbqRu',
        inviteUrl: OPEN_DESIGN_DISCORD_INVITE_URL,
        onlineCount: 0,
        memberCount: 0,
        fetchedAt: Date.now(),
        stale: true,
      };
      res.json(payload);
    }
  });
}
