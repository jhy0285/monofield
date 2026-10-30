import type { Express } from 'express';
import {
  EXECUTION_PERMISSION_LEVELS,
  isExecutionPermissionLevel,
  type UpdateExecutionPermissionsRequest,
} from '@open-design/contracts';
import type { RouteDeps } from '../server-context.js';
import {
  readExecutionPermissions,
  writeExecutionPermissionLevel,
} from '../execution-permissions.js';

export interface RegisterExecutionPermissionsRoutesDeps extends RouteDeps<'http' | 'paths'> {}

/**
 * Settings → Execution permissions and `monofield permissions`. One global
 * level (read-only, default, full) decides the Codex sandbox, the Claude Code
 * permission mode and whether MonoField Desktop starts elevated on Windows.
 * Runs started after a change use the new level; running ones keep theirs.
 */
export function registerExecutionPermissionsRoutes(
  app: Express,
  ctx: RegisterExecutionPermissionsRoutesDeps,
) {
  const { isLocalSameOrigin, resolvedPortRef, sendApiError } = ctx.http;
  const { RUNTIME_DATA_DIR } = ctx.paths;

  app.get('/api/execution-permissions', async (req, res) => {
    if (!isLocalSameOrigin(req, resolvedPortRef.current)) {
      return sendApiError(res, 403, 'FORBIDDEN', 'cross-origin request rejected');
    }
    try {
      res.json(await readExecutionPermissions(RUNTIME_DATA_DIR));
    } catch (err: any) {
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err?.message ?? err));
    }
  });

  app.put('/api/execution-permissions', async (req, res) => {
    if (!isLocalSameOrigin(req, resolvedPortRef.current)) {
      return sendApiError(res, 403, 'FORBIDDEN', 'cross-origin request rejected');
    }
    const body = (req.body ?? {}) as Partial<UpdateExecutionPermissionsRequest>;
    if (!isExecutionPermissionLevel(body.level)) {
      return sendApiError(
        res,
        400,
        'BAD_REQUEST',
        `level must be one of: ${EXECUTION_PERMISSION_LEVELS.join(', ')}`,
      );
    }
    try {
      res.json(await writeExecutionPermissionLevel(RUNTIME_DATA_DIR, body.level));
    } catch (err: any) {
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err?.message ?? err));
    }
  });
}
