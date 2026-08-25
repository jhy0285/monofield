'use client';

import { useState } from 'react';
import type {
  StructuredDocumentKind,
  StructuredDocumentRenderAction,
  StructuredDocumentRenderErrorResponse,
  StructuredDocumentRenderResponse,
} from '@open-design/contracts';
import { useI18n } from '../../i18n';
import styles from './DocumentRenderActions.module.css';

export function DocumentRenderActions({
  projectId,
  inputFile,
  kind,
  dirty,
  fatalCount,
  onSave,
  onRefresh,
  onOpenFile,
}: {
  projectId: string;
  inputFile: string;
  kind: StructuredDocumentKind;
  dirty: boolean;
  fatalCount: number;
  onSave: () => Promise<boolean>;
  onRefresh?: () => Promise<void> | void;
  onOpenFile?: (name: string) => void;
}) {
  const { locale, t } = useI18n();
  const ko = locale === 'ko';
  const [busy, setBusy] = useState<StructuredDocumentRenderAction | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  async function run(action: StructuredDocumentRenderAction) {
    if (busy) return;
    setBusy(action);
    setMessage(null);
    try {
      if (dirty && !(await onSave())) return;
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/documents/render`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputFile, action }),
      });
      const payload = await response.json().catch(() => null) as
        | StructuredDocumentRenderResponse
        | StructuredDocumentRenderErrorResponse
        | null;
      if (!response.ok || !payload?.ok) {
        const fallback = ko ? '문서를 렌더링하지 못했습니다.' : 'Could not render the document.';
        throw new Error(payload && !payload.ok ? payload.message : fallback);
      }
      await onRefresh?.();
      if (action === 'preview') {
        onOpenFile?.(payload.outputFile);
        setMessage({ tone: 'success', text: ko ? '최신 미리보기를 열었습니다.' : 'Opened the latest preview.' });
      } else {
        const anchor = document.createElement('a');
        anchor.href = payload.outputUrl;
        anchor.download = payload.outputFile;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setMessage({
          tone: 'success',
          text: ko ? `${payload.outputFile} 내보내기를 시작했습니다.` : `Started exporting ${payload.outputFile}.`,
        });
      }
    } catch (error) {
      setMessage({
        tone: 'error',
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
    }
  }

  const exportLabel = kind === 'screen-spec' ? 'PPTX' : 'XLSX';
  return (
    <div className={styles.root}>
      <button
        className="viewer-action"
        disabled={busy !== null}
        onClick={() => void run('preview')}
        type="button"
      >
        {busy === 'preview' ? (ko ? '미리보기 생성 중…' : 'Building preview…') : t('common.preview')}
      </button>
      <button
        className="viewer-action"
        disabled={busy !== null || fatalCount > 0}
        onClick={() => void run('export')}
        title={fatalCount > 0
          ? (ko ? `치명 오류 ${fatalCount}건을 먼저 해결하세요.` : `Resolve ${fatalCount} fatal issue(s) first.`)
          : undefined}
        type="button"
      >
        {busy === 'export'
          ? (ko ? `${exportLabel} 생성 중…` : `Building ${exportLabel}…`)
          : `${exportLabel} ${ko ? '내보내기' : 'Export'}`}
      </button>
      {message ? <span className={message.tone === 'error' ? styles.error : styles.success} role="status">{message.text}</span> : null}
    </div>
  );
}
