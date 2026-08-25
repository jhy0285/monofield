'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectFile, ScreenSpecDocument } from '@open-design/contracts';
import { parseScreenSpecDocument, validateScreenSpecDocument } from '@open-design/contracts';
import type { ArtifactManifest } from '../../artifacts/types';
import { useI18n } from '../../i18n';
import { fetchProjectFileText, writeProjectTextFileDetailed } from '../../providers/registry';
import {
  addCalloutAtPosition,
  addCalloutRelation,
  addCheckpoint,
  addLevel,
  addScreen,
  applyScreenSpecCommand,
  deleteCallout,
  deleteCalloutRelation,
  deleteCheckpoint,
  deleteLevel,
  deleteScreen,
  moveCallout,
  updateCallout,
  updateCalloutRelation,
  updateCheckpoint,
  updateLevel,
  updateScreenAt,
  updateScreenImage,
  updateScreenMetadata,
  updateVisualSettings,
} from './editor-model';
import { CalloutTable, CheckpointEditor, MetadataPanel, RelationEditor } from './panels';
import { ScreenSpecCanvas } from './ScreenSpecCanvas';
import { DocumentRenderActions } from '../document-spec/DocumentRenderActions';
import styles from './ScreenSpecEditor.module.css';

/**
 * Interactive structured editor for `kind: "screen-spec"` JSON artifacts.
 * The JSON document stays the single source of truth: agents write it, this
 * editor mutates it in place, and the deterministic PPTX/HTML renderers on
 * the daemon read it. Nobody edits rendered output directly.
 */

interface Props {
  projectId: string;
  file: ProjectFile;
  onFileSaved?: () => Promise<void> | void;
  onOpenFile?: (name: string) => void;
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready' };

export function ScreenSpecEditor({ projectId, file, onFileSaved, onOpenFile }: Props) {
  const { t, locale } = useI18n();
  const [loadState, setLoadState] = useState<LoadState>({ phase: 'loading' });
  const [doc, setDoc] = useState<ScreenSpecDocument | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);
  const [diskChanged, setDiskChanged] = useState(false);
  const [screenIndex, setScreenIndex] = useState(0);
  const [selectedCalloutNo, setSelectedCalloutNo] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [command, setCommand] = useState('');
  const [commandResult, setCommandResult] = useState<{ ok: boolean; message: string } | null>(null);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  const load = useCallback(async () => {
    const text = await fetchProjectFileText(projectId, file.name, { cache: 'no-store' });
    if (text == null) {
      setLoadState({ phase: 'error', message: t('screenSpec.loadFailed') });
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      setLoadState({ phase: 'error', message: t('screenSpec.invalidJson') });
      return;
    }
    const parsed = parseScreenSpecDocument(json);
    if (!parsed.ok) {
      setLoadState({ phase: 'error', message: parsed.error });
      return;
    }
    setDoc(parsed.doc);
    setDirty(false);
    setDiskChanged(false);
    setScreenIndex((prev) => Math.min(prev, Math.max(0, parsed.doc.screens.length - 1)));
    setLoadState({ phase: 'ready' });
  }, [projectId, file.name, t]);

  // Initial load + reload requests. On external mtime bumps only reload when
  // there are no local edits; otherwise surface a "changed on disk" notice so
  // an agent rewriting the JSON can't silently clobber in-progress edits.
  useEffect(() => {
    if (dirtyRef.current) {
      setDiskChanged(true);
      return;
    }
    setLoadState({ phase: 'loading' });
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, file.name, file.mtime, reloadKey]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const issues = useMemo(() => (doc ? validateScreenSpecDocument(doc) : []), [doc]);
  const fatalIssues = issues.filter((issue) => issue.severity === 'fatal');
  const warningIssues = issues.filter((issue) => issue.severity === 'warning');

  const mutateDoc = useCallback((update: (doc: ScreenSpecDocument) => ScreenSpecDocument) => {
    setDoc((prev) => (prev ? update(prev) : prev));
    setDirty(true);
    setSavedFlash(false);
  }, []);

  const mutateScreen = useCallback(
    (update: (screen: ScreenSpecDocument['screens'][number]) => ScreenSpecDocument['screens'][number]) => {
      mutateDoc((d) => updateScreenAt(d, screenIndex, update));
    },
    [mutateDoc, screenIndex],
  );

  async function save(): Promise<boolean> {
    if (!doc || saving) return false;
    setSaving(true);
    setSaveError('');
    const manifest: ArtifactManifest = {
      version: 1,
      ...(file.artifactManifest as ArtifactManifest | undefined),
      kind: 'screen-spec',
      renderer: 'screen-spec',
      title: doc.name,
      entry: file.name,
      status: 'complete',
      exports: ['pptx', 'txt', 'zip'],
    };
    const result = await writeProjectTextFileDetailed(
      projectId,
      file.name,
      JSON.stringify(doc, null, 2),
      { artifactManifest: manifest },
    );
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.message);
      return false;
    }
    setDirty(false);
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1500);
    await onFileSaved?.();
    return true;
  }

  if (loadState.phase === 'loading') {
    return (
      <div className="viewer">
        <div className="viewer-body">
          <div className="viewer-empty">{t('screenSpec.loading')}</div>
        </div>
      </div>
    );
  }

  if (loadState.phase === 'error' || !doc) {
    return (
      <div className="viewer">
        <div className="viewer-body">
          <div className={styles.errorBox}>
            <p>{loadState.phase === 'error' ? loadState.message : t('screenSpec.loadFailed')}</p>
            <button
              className={styles.smallButton}
              onClick={() => setReloadKey((n) => n + 1)}
              type="button"
            >
              {t('screenSpec.reload')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const screen = doc.screens[screenIndex];

  return (
    <div className={`viewer ${styles.root}`}>
      <div className="viewer-toolbar">
        <div className={styles.screenTabs}>
          {doc.screens.map((s, i) => (
            <button
              className={`${styles.screenTab} ${i === screenIndex ? styles.screenTabActive : ''}`}
              key={`${s.id}-${i}`}
              onClick={() => {
                setScreenIndex(i);
                setSelectedCalloutNo(null);
              }}
              type="button"
            >
              {s.screenName || s.id || t('screenSpec.screenFallback', { no: i + 1 })}
            </button>
          ))}
          <button
            className={styles.screenTab}
            onClick={() => {
              mutateDoc(addScreen);
              setScreenIndex(doc.screens.length);
            }}
            title={t('screenSpec.addScreen')}
            type="button"
          >
            +
          </button>
        </div>
        <div className="viewer-toolbar-actions">
          {doc.screens.length > 1 && (
            <button
              className="viewer-action"
              onClick={() => {
                if (!window.confirm(t('screenSpec.deleteScreenConfirm'))) return;
                mutateDoc((d) => deleteScreen(d, screenIndex));
                setScreenIndex((prev) => Math.max(0, prev - 1));
                setSelectedCalloutNo(null);
              }}
              type="button"
            >
              {t('screenSpec.deleteScreen')}
            </button>
          )}
          <button
            className="viewer-action"
            onClick={() => {
              if (dirty && !window.confirm(locale === 'ko' ? '저장하지 않은 변경사항을 버리고 다시 불러올까요?' : 'Discard unsaved changes and reload?')) return;
              setDirty(false);
              setReloadKey((n) => n + 1);
            }}
            title={t('screenSpec.reloadTitle')}
            type="button"
          >
            {t('screenSpec.reload')}
          </button>
          <DocumentRenderActions
            dirty={dirty}
            fatalCount={fatalIssues.length}
            inputFile={file.name}
            kind="screen-spec"
            onOpenFile={onOpenFile}
            onRefresh={onFileSaved}
            onSave={save}
            projectId={projectId}
          />
          <button
            className="viewer-action"
            disabled={!dirty || saving}
            onClick={() => void save()}
            type="button"
          >
            {saving
              ? t('screenSpec.saving')
              : savedFlash
                ? t('screenSpec.saved')
                : dirty
                  ? t('screenSpec.saveDirty')
                  : t('screenSpec.save')}
          </button>
        </div>
      </div>

      <div className={`viewer-body ${styles.body}`}>
        {diskChanged && (
          <div className={styles.noticeBanner}>
            <span>{t('screenSpec.fileChangedOnDisk')}</span>
            <button
              className={styles.smallButton}
              onClick={() => {
                setDirty(false);
                setReloadKey((n) => n + 1);
              }}
              type="button"
            >
              {t('screenSpec.reloadFromDisk')}
            </button>
          </div>
        )}
        {saveError && <div className={styles.errorBanner}>{saveError}</div>}
        {fatalIssues.length > 0 && (
          <div className={styles.warnBanner}>
            {t('screenSpec.fatalIssues', { count: fatalIssues.length })}{' '}
            {fatalIssues.map((issue) => issue.message).join(' / ')}
          </div>
        )}
        {warningIssues.length > 0 && (
          <details className={styles.issueDetails}>
            <summary>{locale === 'ko' ? `검토 권장 ${warningIssues.length}건` : `${warningIssues.length} validation warning(s)`}</summary>
            <ul>{warningIssues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul>
          </details>
        )}

        {screen ? (
          <div className={styles.layout}>
            <div className={styles.leftColumn}>
              <ScreenSpecCanvas
                onAddCallout={(position) =>
                  mutateScreen((s) => {
                    const next = addCalloutAtPosition(
                      s,
                      position,
                      t('screenSpec.defaultCalloutLabel', { no: s.callouts.length + 1 }),
                    );
                    return next;
                  })
                }
                onImageUpload={(dataUrl) => mutateScreen((s) => updateScreenImage(s, dataUrl))}
                onMoveCallout={(no, position) => mutateScreen((s) => moveCallout(s, no, position))}
                onSelectCallout={setSelectedCalloutNo}
                onUpdateVisualSettings={(patch) => mutateScreen((s) => updateVisualSettings(s, patch))}
                projectId={projectId}
                screen={screen}
                selectedCalloutNo={selectedCalloutNo}
              />
              <RelationEditor
                callouts={screen.callouts}
                onAddRelation={() => mutateScreen(addCalloutRelation)}
                onDeleteRelation={(index) => mutateScreen((s) => deleteCalloutRelation(s, index))}
                onUpdateRelation={(index, patch) =>
                  mutateScreen((s) => updateCalloutRelation(s, index, patch))
                }
                onUpdateVisualSettings={(patch) => mutateScreen((s) => updateVisualSettings(s, patch))}
                relations={screen.calloutRelations}
                visualSettings={screen.visualSettings}
              />
            </div>
            <div className={styles.rightColumn}>
              <section className={styles.panel}>
                <div className={styles.panelHeading}>
                  <div><h3>{locale === 'ko' ? '빠른 자연어 수정' : 'Quick natural-language edit'}</h3><p className={styles.panelHint}>{locale === 'ko' ? '자주 쓰는 수정은 모델 호출 없이 즉시 적용합니다.' : 'Common edits apply instantly without a model call.'}</p></div>
                </div>
                <div className={styles.commandRow}>
                  <input value={command} placeholder={locale === 'ko' ? '예: 1번 설명을 로그인 버튼으로 바꿔줘' : 'Example: change marker 1 description to Login button'} onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    const result = applyScreenSpecCommand(screen, command);
                    setCommandResult(result);
                    if (result.ok) { mutateScreen(() => result.screen); setCommand(''); }
                  }} />
                  <button className={styles.smallButton} type="button" disabled={!command.trim()} onClick={() => {
                    const result = applyScreenSpecCommand(screen, command);
                    setCommandResult(result);
                    if (result.ok) { mutateScreen(() => result.screen); setCommand(''); }
                  }}>{locale === 'ko' ? '적용' : 'Apply'}</button>
                </div>
                {commandResult ? <p className={commandResult.ok ? styles.commandSuccess : styles.commandError} role="status">{commandResult.message}</p> : null}
              </section>
              <CalloutTable
                callouts={screen.callouts}
                onDeleteCallout={(no) => {
                  mutateScreen((s) => deleteCallout(s, no));
                  setSelectedCalloutNo(null);
                }}
                onSelectCallout={setSelectedCalloutNo}
                onUpdateCallout={(no, patch) => mutateScreen((s) => updateCallout(s, no, patch))}
                selectedCalloutNo={selectedCalloutNo}
              />
              <CheckpointEditor
                checkpoints={screen.checkpoints}
                onAddCheckpoint={(text) => mutateScreen((s) => addCheckpoint(s, text))}
                onDeleteCheckpoint={(index) => mutateScreen((s) => deleteCheckpoint(s, index))}
                onUpdateCheckpoint={(index, text) =>
                  mutateScreen((s) => updateCheckpoint(s, index, text))
                }
              />
              <MetadataPanel
                onAddLevel={() => mutateScreen(addLevel)}
                onDeleteLevel={(index) => mutateScreen((s) => deleteLevel(s, index))}
                onUpdateLevel={(index, value) => mutateScreen((s) => updateLevel(s, index, value))}
                onUpdateMetadata={(patch) => mutateScreen((s) => updateScreenMetadata(s, patch))}
                screen={screen}
              />
            </div>
          </div>
        ) : (
          <div className="viewer-empty">
            <button
              className={styles.smallButton}
              onClick={() => {
                mutateDoc(addScreen);
                setScreenIndex(0);
              }}
              type="button"
            >
              {t('screenSpec.addScreen')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
