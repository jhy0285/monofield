import type { Express } from 'express';
import type {
  MonoFieldGithubLatestReleaseResponse,
  MonoFieldGithubRepoResponse,
} from '@open-design/contracts';
import type { RouteDeps } from '../server-context.js';
import type { MonoFieldPublicMetadataService } from '../services/monofield-public-metadata.js';

export interface RegisterMonoFieldPublicMetadataRoutesDeps extends RouteDeps<'http'> {
  monoFieldPublicMetadata: MonoFieldPublicMetadataService;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function registerMonoFieldPublicMetadataRoutes(
  app: Express,
  ctx: RegisterMonoFieldPublicMetadataRoutesDeps,
): void {
  const { monoFieldPublicMetadata } = ctx;

  app.get('/api/github/monofield', async (_req, res) => {
    try {
      const stats = await monoFieldPublicMetadata.readGithubRepoStats();
      const payload: MonoFieldGithubRepoResponse = {
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

  app.get('/api/github/monofield/releases/latest', async (_req, res) => {
    try {
      const release = await monoFieldPublicMetadata.readLatestReleaseInfo();
      const payload: MonoFieldGithubLatestReleaseResponse = {
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

}
