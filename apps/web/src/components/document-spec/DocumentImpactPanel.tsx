'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@open-design/components';
import type { DocumentImpactResponse, DocumentProposalResponse, InterfaceSpecDocument } from '@open-design/contracts';
import { useI18n } from '../../i18n';
import { fetchProjectFileText } from '../../providers/registry';
import styles from './DocumentImpactPanel.module.css';
import { compareInterfaceDocuments } from './document-changes';

export async function documentContentHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function DocumentImpactPanel({ projectId, inputFile, doc, loadedContentSha256, dirty, onRequestUpdate, onApplyProposal }: {
  projectId: string; inputFile: string; doc: InterfaceSpecDocument; dirty: boolean;
  loadedContentSha256?: string | undefined;
  onRequestUpdate?: (prompt: string) => void;
  onApplyProposal: (proposal: InterfaceSpecDocument) => void;
}) {
  const { t } = useI18n();
  const [report, setReport] = useState<DocumentImpactResponse | null>(null);
  const [proposal, setProposal] = useState<InterfaceSpecDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changes = useMemo(() => proposal ? compareInterfaceDocuments(doc, proposal) : [], [doc, proposal]);
  const scope = useRef(0);
  useEffect(() => {
    scope.current += 1; setReport(null); setProposal(null); setError(''); setBusy(false);
    return () => { scope.current += 1; };
  }, [projectId, inputFile]);

  async function analyze() {
    const currentScope = scope.current;
    setBusy(true); setError(''); setProposal(null); setReport(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/documents/impact`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ inputFile }),
      });
      const payload = await response.json() as DocumentImpactResponse | { error?: { message?: string } };
      if (!response.ok || !('ok' in payload)) throw new Error('error' in payload ? payload.error?.message : t('docs.impact.failed'));
      if (loadedContentSha256 && loadedContentSha256 !== payload.contentSha256) throw new Error(t('docs.impact.conflict'));
      if (currentScope === scope.current) setReport(payload);
    } catch (failure) { if (currentScope === scope.current) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { if (currentScope === scope.current) setBusy(false); }
  }

  async function assertBaseline() {
    const text = await fetchProjectFileText(projectId, inputFile, { cache: 'no-store' });
    if (text == null || !report || await documentContentHash(text) !== report.contentSha256) {
      throw new Error(t('docs.impact.conflict'));
    }
  }

  async function review() {
    if (!report) return;
    const currentScope = scope.current;
    setBusy(true); setError(''); setProposal(null);
    try {
      await assertBaseline();
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/documents/proposal`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
          inputFile, proposalFile: report.proposalFile, expectedContentSha256: report.contentSha256,
        }),
      });
      const result = await response.json() as DocumentProposalResponse | { error?: { message?: string } };
      if (!response.ok || !('ok' in result) || !result.document) {
        throw new Error('error' in result ? result.error?.message : t('docs.impact.proposalMissing'));
      }
      if (currentScope === scope.current) setProposal(result.document);
    } catch (failure) { if (currentScope === scope.current) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { if (currentScope === scope.current) setBusy(false); }
  }

  async function apply() {
    if (!proposal) return;
    const currentScope = scope.current;
    setBusy(true); setError('');
    try {
      await assertBaseline();
      if (currentScope !== scope.current) return;
      onApplyProposal({ ...proposal, endpoints: proposal.endpoints.map((endpoint) => ({
        ...endpoint,
        requestFields: endpoint.requestFields.map((field) => field.reviewStatus === 'unreviewed' ? { ...field, reviewStatus: 'accepted' } : field),
        responseFields: endpoint.responseFields.map((field) => field.reviewStatus === 'unreviewed' ? { ...field, reviewStatus: 'accepted' } : field),
      })) });
      setProposal(null); setReport(null);
    } catch (failure) { if (currentScope === scope.current) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { if (currentScope === scope.current) setBusy(false); }
  }

  return <section className={styles.root} aria-label={t('docs.impact.title')}>
    <div className={styles.heading}><div><h3>{t('docs.impact.title')}</h3><p>{t('docs.impact.scope')}</p></div>
      <Button disabled={busy || dirty} onClick={() => void analyze()}>{busy ? t('common.loading') : t('docs.impact.analyze')}</Button>
    </div>
    {dirty ? <p role="status">{t('docs.impact.saveFirst')}</p> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {report ? <div>
      <p>{report.repository ? t('docs.impact.summary', { affected: report.affected.length, unknown: report.untrackedEndpointIndexes.length }) : t('docs.impact.noGit')}</p>
      <ul>{report.affected.map((item) => <li key={item.endpointIndex}><strong>{item.endpointId} · {item.title}</strong><span>{item.changedFiles.join(', ')}</span></li>)}</ul>
      <div className={styles.actions}>
        <Button disabled={busy || dirty || !onRequestUpdate || !report.repository} onClick={() => onRequestUpdate?.(report.updatePrompt)}>{t('docs.impact.request')}</Button>
        <Button disabled={busy || dirty} onClick={() => void review()}>{t('docs.impact.review')}</Button>
      </div>
    </div> : null}
    {proposal ? <div>
      <p>{t('docs.impact.reviewHint')}</p>
      <div className={styles.changes}><table>
        <thead><tr><th>{t('docs.impact.change')}</th><th>{t('docs.impact.before')}</th><th>{t('docs.impact.after')}</th></tr></thead>
        <tbody>{changes.slice(0, 200).map((change) => <tr key={change.target}><th>{change.target}</th><td>{change.before}</td><td>{change.after}</td></tr>)}</tbody>
      </table></div>
      {changes.length > 200 ? <p>200 / {changes.length}</p> : null}
      <details><summary>JSON</summary>
      <div className={styles.comparison}>
        <details open><summary>{t('docs.impact.before')}</summary><pre>{JSON.stringify(doc, null, 2)}</pre></details>
        <details open><summary>{t('docs.impact.after')}</summary><pre>{JSON.stringify(proposal, null, 2)}</pre></details>
      </div>
      </details>
      <Button variant="primary" disabled={dirty || busy} onClick={() => void apply()}>{t('docs.impact.apply')}</Button>
    </div> : null}
  </section>;
}
