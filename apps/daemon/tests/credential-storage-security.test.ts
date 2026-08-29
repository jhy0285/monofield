import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readAppConfig } from '../src/app-config.js';
import { configureComposioConfigStore, readPublicComposioConfig, resolveComposioApiKey } from '../src/connectors/composio-config.js';
import { FileConnectorCredentialStore } from '../src/connectors/service.js';
import { getXAIToken } from '../src/integrations/xai-tokens.js';
import { readMcpConfig, readPublicMcpConfig } from '../src/mcp-config.js';
import { readAllTokens } from '../src/mcp-tokens.js';
import { getOrRegisterClient } from '../src/mcp-oauth.js';
import { readMaskedConfig, resolveProviderConfig } from '../src/media/config.js';
import {
  CLOUDFLARE_PAGES_PROVIDER_ID,
  deployConfigPath,
  readCloudflarePagesConfig,
  readVercelConfig,
  VERCEL_PROVIDER_ID,
} from '../src/deploy.js';
import { installTestCredentialVault, type TestCredentialVault } from './helpers/credential-vault.js';

describe('legacy credential migration security', () => {
  let root: string;
  let dataDir: string;
  let projectRoot: string;
  let vault: TestCredentialVault;
  let previousMediaConfigDir: string | undefined;
  let previousUserStateDir: string | undefined;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'monofield-credential-migration-'));
    dataDir = path.join(root, 'data');
    projectRoot = path.join(root, 'project');
    await mkdir(path.join(dataDir, 'connectors'), { recursive: true });
    await mkdir(path.join(projectRoot, '.od'), { recursive: true });
    previousMediaConfigDir = process.env.OD_MEDIA_CONFIG_DIR;
    previousUserStateDir = process.env.OD_USER_STATE_DIR;
    process.env.OD_MEDIA_CONFIG_DIR = path.join(projectRoot, '.od');
    process.env.OD_USER_STATE_DIR = path.join(root, 'state');
    configureComposioConfigStore(dataDir);
    vault = installTestCredentialVault();
  });

  afterEach(async () => {
    vault.restore();
    if (previousMediaConfigDir === undefined) delete process.env.OD_MEDIA_CONFIG_DIR;
    else process.env.OD_MEDIA_CONFIG_DIR = previousMediaConfigDir;
    if (previousUserStateDir === undefined) delete process.env.OD_USER_STATE_DIR;
    else process.env.OD_USER_STATE_DIR = previousUserStateDir;
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  async function seedLegacyFiles(): Promise<Record<string, string>> {
    const secrets = {
      media: 'media-secret-value',
      mcpEnv: 'mcp-env-secret',
      mcpHeader: 'Bearer mcp-header-secret',
      composio: 'composio-secret-value',
      connector: 'connector-access-secret',
      mcpAccess: 'mcp-oauth-access-secret',
      mcpRefresh: 'mcp-oauth-refresh-secret',
      xaiAccess: 'xai-oauth-access-secret',
      xaiRefresh: 'xai-oauth-refresh-secret',
      cli: 'local-cli-api-key-secret',
      mcpClient: 'mcp-client-registration-secret',
      vercel: 'vercel-deployment-secret',
      cloudflare: 'cloudflare-deployment-secret',
    };
    await writeFile(path.join(projectRoot, '.od', 'media-config.json'), JSON.stringify({
      providers: { openai: { apiKey: secrets.media, baseUrl: 'https://api.openai.com/v1' } },
    }));
    await writeFile(path.join(dataDir, 'mcp-config.json'), JSON.stringify({
      servers: [{ id: 'github', transport: 'stdio', enabled: true, command: 'npx', env: { TOKEN: secrets.mcpEnv } },
        { id: 'remote', transport: 'http', enabled: true, url: 'https://mcp.example.test', headers: { Authorization: secrets.mcpHeader } }],
    }));
    await writeFile(path.join(dataDir, 'connectors', 'composio-config.json'), JSON.stringify({
      apiKey: secrets.composio,
      authConfigIds: {},
    }));
    await writeFile(path.join(dataDir, 'connectors', 'credentials.json'), JSON.stringify({
      github: {
        schemaVersion: 1,
        connectorId: 'github',
        accountLabel: 'dev@example.test',
        credentials: { provider: 'composio', accessToken: secrets.connector },
        updatedAt: '2026-08-28T00:00:00.000Z',
      },
    }));
    await writeFile(path.join(dataDir, 'mcp-tokens.json'), JSON.stringify({
      servers: { remote: { accessToken: secrets.mcpAccess, refreshToken: secrets.mcpRefresh, tokenType: 'Bearer', savedAt: 1 } },
    }));
    await writeFile(path.join(dataDir, 'xai-tokens.json'), JSON.stringify({
      token: { accessToken: secrets.xaiAccess, refreshToken: secrets.xaiRefresh, tokenType: 'Bearer', savedAt: 1 },
    }));
    await writeFile(path.join(dataDir, 'app-config.json'), JSON.stringify({
      agentCliEnv: { codex: { OPENAI_API_KEY: secrets.cli } },
      agentCliEnvIntent: { codex: { apiKeyOverride: true } },
    }));
    await writeFile(path.join(dataDir, 'mcp-oauth-clients.json'), JSON.stringify({ clients: [{
      authServerIssuer: 'https://auth.example.test',
      redirectUri: 'http://127.0.0.1/callback',
      clientId: 'legacy-client',
      clientSecret: secrets.mcpClient,
      registeredAt: 1,
    }] }));
    await mkdir(path.dirname(deployConfigPath(VERCEL_PROVIDER_ID)), { recursive: true });
    await writeFile(deployConfigPath(VERCEL_PROVIDER_ID), JSON.stringify({
      token: secrets.vercel,
      teamId: 'team-1',
    }));
    await writeFile(deployConfigPath(CLOUDFLARE_PAGES_PROVIDER_ID), JSON.stringify({
      token: secrets.cloudflare,
      accountId: 'account-1',
    }));
    return secrets;
  }

  async function triggerEveryMigration(): Promise<void> {
    await readMaskedConfig(projectRoot);
    await readPublicMcpConfig(dataDir);
    await readPublicComposioConfig();
    await new FileConnectorCredentialStore(dataDir).get('github');
    await readAllTokens(dataDir);
    await getXAIToken(dataDir);
    await readAppConfig(dataDir);
    await getOrRegisterClient(dataDir, {
      issuer: 'https://auth.example.test',
      authorization_endpoint: 'https://auth.example.test/authorize',
      token_endpoint: 'https://auth.example.test/token',
    }, 'http://127.0.0.1/callback');
    await readVercelConfig();
    await readCloudflarePagesConfig();
  }

  async function diskText(): Promise<string> {
    return (await Promise.all(credentialMetadataFiles().map((file) => readFile(file, 'utf8')))).join('\n');
  }

  function credentialMetadataFiles(): string[] {
    return [
      path.join(projectRoot, '.od', 'media-config.json'),
      path.join(dataDir, 'mcp-config.json'),
      path.join(dataDir, 'connectors', 'composio-config.json'),
      path.join(dataDir, 'connectors', 'credentials.json'),
      path.join(dataDir, 'mcp-tokens.json'),
      path.join(dataDir, 'xai-tokens.json'),
      path.join(dataDir, 'app-config.json'),
      path.join(dataDir, 'mcp-oauth-clients.json'),
      deployConfigPath(VERCEL_PROVIDER_ID),
      deployConfigPath(CLOUDFLARE_PAGES_PROVIDER_ID),
    ];
  }

  it('moves every legacy secret to the vault before scrubbing plaintext JSON', async () => {
    const secrets = await seedLegacyFiles();
    await triggerEveryMigration();

    const persisted = await diskText();
    for (const secret of Object.values(secrets)) expect(persisted).not.toContain(secret);
    expect(persisted).toContain('credentialRef');

    await expect(resolveProviderConfig(projectRoot, 'openai')).resolves.toMatchObject({ apiKey: secrets.media });
    await expect(readMcpConfig(dataDir)).resolves.toMatchObject({ servers: [
      expect.objectContaining({ env: { TOKEN: secrets.mcpEnv } }),
      expect.objectContaining({ headers: { Authorization: secrets.mcpHeader } }),
    ] });
    await expect(resolveComposioApiKey()).resolves.toBe(secrets.composio);
    await expect(new FileConnectorCredentialStore(dataDir).get('github')).resolves.toMatchObject({
      credentials: { accessToken: secrets.connector },
    });
    await expect(readAllTokens(dataDir)).resolves.toMatchObject({ remote: { accessToken: secrets.mcpAccess, refreshToken: secrets.mcpRefresh } });
    await expect(getXAIToken(dataDir)).resolves.toMatchObject({ accessToken: secrets.xaiAccess, refreshToken: secrets.xaiRefresh });
    await expect(readAppConfig(dataDir)).resolves.toMatchObject({
      agentCliEnv: { codex: { OPENAI_API_KEY: secrets.cli } },
    });
    await expect(getOrRegisterClient(dataDir, {
      issuer: 'https://auth.example.test',
      authorization_endpoint: 'https://auth.example.test/authorize',
      token_endpoint: 'https://auth.example.test/token',
    }, 'http://127.0.0.1/callback')).resolves.toMatchObject({
      clientSecret: secrets.mcpClient,
    });
    await expect(readVercelConfig()).resolves.toMatchObject({ token: secrets.vercel });
    await expect(readCloudflarePagesConfig()).resolves.toMatchObject({ token: secrets.cloudflare });
  });

  it('preserves legacy plaintext on vault failure and never writes secrets to warnings', async () => {
    const secrets = await seedLegacyFiles();
    vault.state.failWrites = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await triggerEveryMigration();

    const persisted = await diskText();
    for (const secret of Object.values(secrets)) expect(persisted).toContain(secret);
    const warningText = warn.mock.calls.flat().map(String).join('\n');
    expect(warningText).toContain('migration deferred');
    for (const secret of Object.values(secrets)) expect(warningText).not.toContain(secret);
  });

  it('tightens legacy credential files even when vault migration is deferred', async () => {
    if (process.platform === 'win32') return;
    await seedLegacyFiles();
    const files = credentialMetadataFiles();
    const directories = [...new Set(files.map((file) => path.dirname(file)))];
    await Promise.all(files.map((file) => chmod(file, 0o644)));
    await Promise.all(directories.map((directory) => chmod(directory, 0o755)));
    vault.state.failWrites = true;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await triggerEveryMigration();

    for (const file of files) {
      expect((await stat(file)).mode & 0o777, file).toBe(0o600);
    }
    for (const directory of directories) {
      expect((await stat(directory)).mode & 0o777, directory).toBe(0o700);
    }
  });

  it('does not partially scrub one MCP metadata file when a later vault write fails', async () => {
    const secrets = await seedLegacyFiles();
    vault.state.failAfterWrites = 1;
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await readPublicMcpConfig(dataDir);

    const persisted = await readFile(path.join(dataDir, 'mcp-config.json'), 'utf8');
    expect(persisted).toContain(secrets.mcpEnv);
    expect(persisted).toContain(secrets.mcpHeader);
    const stagedVaultText = JSON.stringify([...vault.values.values()]);
    expect(stagedVaultText).not.toContain(secrets.mcpEnv);
    expect(stagedVaultText).not.toContain(secrets.mcpHeader);
    expect(warning.mock.calls.flat().join(' ')).toContain('migration deferred');
  });
});
