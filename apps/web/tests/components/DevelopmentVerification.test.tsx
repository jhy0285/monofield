// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DevelopmentVerification } from '../../src/components/DevelopmentVerification';
import { I18nProvider } from '../../src/i18n';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const run = { id: 'r1', script: 'test', command: 'npm run test', state: 'passed', exitCode: 0,
  output: 'one test passed', startedAt: new Date().toISOString(), sourceFingerprint: 'abc', sourceChangedDuringRun: false };
it('posts the selected script and replaces a success badge after sources change', async () => {
  let freshness = 'current';
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ scripts: ['test'], run, freshness })));
  vi.stubGlobal('fetch', fetcher);
  render(<I18nProvider initial="ko"><DevelopmentVerification projectId="p1" projectPath="app" /></I18nProvider>);
  await screen.findByText('현재 소스에서 성공');
  fireEvent.click(screen.getByRole('button', { name: '실행' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/projects/p1/development/verification', expect.objectContaining({
    method: 'POST', body: JSON.stringify({ script: 'test', projectPath: 'app' }),
  })));
  await waitFor(() => expect((screen.getByRole('button', { name: '결과 새로고침' }) as HTMLButtonElement).disabled).toBe(false));
  freshness = 'stale';
  fireEvent.click(screen.getByRole('button', { name: '결과 새로고침' }));
  await screen.findByText('소스 변경됨 · 다시 검증 필요');
  expect(screen.queryByText('현재 소스에서 성공')).toBeNull();
});
it('removes old success evidence when refreshing fails', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ scripts: ['test'], run, freshness: 'current' })))
    .mockRejectedValueOnce(new Error('offline'));
  vi.stubGlobal('fetch', fetcher);
  render(<I18nProvider initial="ko"><DevelopmentVerification projectId="p1" /></I18nProvider>);
  await screen.findByText('현재 소스에서 성공');
  fireEvent.click(screen.getByRole('button', { name: '결과 새로고침' }));
  await screen.findByRole('alert');
  expect(screen.queryByText('현재 소스에서 성공')).toBeNull();
});
