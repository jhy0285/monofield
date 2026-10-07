// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { JevSettingsPanel } from '../../src/components/JevSettingsPanel';

vi.mock('../../src/i18n', () => ({ useT: () => (key: string) => key }));
const status = (backend: 'typesafe' | 'local' = 'typesafe') => ({ config: { backend, localBaseUrl: 'http://127.0.0.1:8000', model: backend === 'local' ? 'multilingual' : 'jev-latest' }, credentialSource: 'none', apiKeyTail: '', ready: backend === 'local' });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('typed decision settings', () => {
  it('makes missing hosted authentication explicit and does not issue an inference request', async () => {
    const mock = vi.fn(async () => Response.json(status())); vi.stubGlobal('fetch', mock);
    render(<JevSettingsPanel />);
    await screen.findByTestId('jev-auth-required');
    fireEvent.change(screen.getByTestId('jev-state'), { target: { value: 'Fix login' } });
    expect((screen.getByTestId('jev-evaluate') as HTMLButtonElement).disabled).toBe(true);
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it('saves a key through the encrypted-credential API without putting it into configuration', async () => {
    const mock = vi.fn(async (url: string) => Response.json(url === '/api/jev/status' ? status() : {})); vi.stubGlobal('fetch', mock);
    render(<JevSettingsPanel />); await screen.findByTestId('jev-api-key');
    fireEvent.change(screen.getByTestId('jev-api-key'), { target: { value: 'test-only-secret' } }); fireEvent.click(screen.getByTestId('jev-save'));
    await waitFor(() => expect((screen.getByTestId('jev-api-key') as HTMLInputElement).value).toBe(''));
    const calls = mock.mock.calls as unknown as [string, RequestInit][];
    expect(calls.find(([url]) => url === '/api/jev/config')?.[1].body).not.toContain('test-only-secret');
    expect(calls.find(([url]) => url === '/api/byok/credentials')?.[1].body).toBe(JSON.stringify({ credentials: { typesafe: 'test-only-secret' } }));
  });
  it('blocks inference with unsaved settings and clears the previous result when the request changes', async () => {
    const mock = vi.fn(async (url: string) => Response.json(url === '/api/jev/status' ? status('local') : { backend: 'local', requestedModel: 'multilingual', elapsedMs: 52, result: { model: 'laya', answers: { kind: { type: 'choice', choice: 'bug', confidence: 0.9, probabilities: { bug: 0.9, feature: 0.05, question: 0.05 } } }, usage: { input_tokens: 81, output_tokens: 0 } } })); vi.stubGlobal('fetch', mock);
    render(<JevSettingsPanel />); await screen.findByTestId('jev-local-url');
    fireEvent.change(screen.getByTestId('jev-state'), { target: { value: 'Fix login' } }); fireEvent.click(screen.getByTestId('jev-evaluate'));
    await screen.findByTestId('jev-result');
    fireEvent.change(screen.getByTestId('jev-state'), { target: { value: 'Add export' } }); expect(screen.queryByTestId('jev-result')).toBeNull();
    fireEvent.change(screen.getByTestId('jev-local-url'), { target: { value: 'http://127.0.0.1:9000' } });
    expect((screen.getByTestId('jev-evaluate') as HTMLButtonElement).disabled).toBe(true);
  });
  it('shows a real connection failure and allows retry without inventing a result', async () => {
    const mock = vi.fn(async (url: string) => url === '/api/jev/status' ? Response.json(status('local')) : Response.json({ error: { message: 'Could not connect to the decision server.' } }, { status: 502 })); vi.stubGlobal('fetch', mock);
    render(<JevSettingsPanel />); await screen.findByTestId('jev-local-url');
    fireEvent.change(screen.getByTestId('jev-state'), { target: { value: 'Fix login' } }); fireEvent.click(screen.getByTestId('jev-evaluate'));
    await screen.findByRole('alert'); expect(screen.queryByTestId('jev-result')).toBeNull();
    await waitFor(() => expect((screen.getByTestId('jev-evaluate') as HTMLButtonElement).disabled).toBe(false));
  });
});
