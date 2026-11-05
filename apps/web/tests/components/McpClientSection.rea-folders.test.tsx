// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MCP_MASKED_SECRET } from '@open-design/contracts';
import { I18nProvider } from '../../src/i18n';
import { McpClientSection } from '../../src/components/McpClientSection';

const REA_TEMPLATE = {
  id: 'rea',
  label: 'REA (Reverse Engineer Anything)',
  description: 'Investigate shipped applications.',
  transport: 'stdio',
  category: 'utilities',
  command: 'npx',
  args: ['-y', 'rea-agents@6.7.0', '--mcp'],
  envFields: [
    { key: 'GHIDRA_INSTALL_DIR', label: 'Ghidra folder', folder: true, placeholder: 'C:\\ghidra_PUBLIC' },
    { key: 'JAVA_HOME', label: 'Java (JDK) folder', folder: true },
  ],
};
const DOCTOR = { ok: true, ready: false, platform: 'linux', package: { name: 'rea-agents', version: '6.7.0', node: '^22.19.0' }, checks: [] };

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}

describe('REA preset folder inputs', () => {
  let stored: unknown[] = [];
  let puts: Array<{ servers: Array<Record<string, unknown>> }> = [];
  beforeEach(() => {
    localStorage.setItem('open-design:locale', 'en');
    stored = [];
    puts = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/rea/doctor')) return json(DOCTOR);
      if (url.endsWith('/api/mcp/servers')) {
        if (init?.method === 'PUT') {
          const body = JSON.parse(String(init.body)) as { servers: Array<Record<string, unknown>> };
          puts.push(body);
          // the daemon never sends env values back: they come back masked
          stored = body.servers.map((server) => ({
            ...server,
            ...(server.env ? { env: Object.fromEntries(Object.keys(server.env as object).map((key) => [key, MCP_MASKED_SECRET])) } : {}),
          }));
        }
        return json({ servers: stored, templates: [REA_TEMPLATE] });
      }
      if (url.startsWith('/api/agents')) return json({ agents: [] });
      return json({});
    }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  async function addRea() {
    render(<I18nProvider><McpClientSection /></I18nProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Add server' }));
    fireEvent.click(await screen.findByTitle(/Investigate shipped applications/));
    const expand = await screen.findAllByRole('button', { name: /Expand this MCP server/i });
    fireEvent.click(expand[expand.length - 1]!);
  }

  it('adds the two inputs, seeds no empty KEY= lines, and mirrors typed paths into the Env box', async () => {
    await addRea();
    const env = await screen.findByPlaceholderText('GITHUB_TOKEN=ghp_…') as HTMLTextAreaElement;
    expect(env.value).toBe('');
    fireEvent.change(screen.getByLabelText('Ghidra folder'), { target: { value: 'C:\\Program Files\\ghidra' } });
    expect(env.value).toBe('GHIDRA_INSTALL_DIR=C:\\Program Files\\ghidra');
    fireEvent.change(screen.getByLabelText('Ghidra folder'), { target: { value: '' } });
    expect(env.value).toBe('');
  });

  it('saves only the folders that were filled in, then shows them as saved', async () => {
    await addRea();
    fireEvent.change(await screen.findByLabelText('Java (JDK) folder'), { target: { value: '/opt/jdk' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]!.servers[0]).toMatchObject({ id: 'rea', templateId: 'rea', env: { JAVA_HOME: '/opt/jdk' } });
    expect(Object.keys(puts[0]!.servers[0]!.env as object)).toEqual(['JAVA_HOME']);
    // saving rebuilds the rows from the daemon's answer, which collapses them
    const again = await screen.findAllByRole('button', { name: /Expand this MCP server/i });
    fireEvent.click(again[again.length - 1]!);
    const ghidra = await screen.findByLabelText('Ghidra folder') as HTMLInputElement;
    expect(ghidra.placeholder).toBe('C:\\ghidra_PUBLIC');
    expect((screen.getByLabelText('Java (JDK) folder') as HTMLInputElement).placeholder).toMatch(/^Saved \(hidden\)/);
  });
});
