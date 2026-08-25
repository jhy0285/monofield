import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import type {
  DatabaseConnectionSummary,
  DatabaseInspectConcurrency,
  DatabaseInspectResponse,
  DatabaseSchemasResponse,
  DictionaryLibraryDetail,
  DictionaryProjectSnapshot,
} from '@open-design/contracts';
import { getOpenDesignHost } from '@open-design/host';
import { useT } from '../i18n';
import type { DirectionCard, FormOption, QuestionForm } from '../artifacts/question-form';
import { formatFormAnswers, formOptionValueForLabel } from '../artifacts/question-form';
import {
  attachDictionaryToProject,
  fetchDictionaryLibraries,
  fetchDictionaryLibrary,
  fetchProjectDictionarySnapshots,
  fetchProjectFiles,
  fetchProjectFileText,
  uploadDictionaryLibrary,
  uploadProjectFiles,
  writeProjectTextFile,
} from '../providers/registry';
import dictionaryStyles from './QuestionForm.dictionary.module.css';
import {
  InterfaceSpecManualInput,
  isInterfaceSpecManualDraftReady,
} from './InterfaceSpecManualInput';

interface Props {
  form: QuestionForm;
  /** Project storage keeps user-selected mapping/dictionary files out of chat text. */
  projectId?: string;
  // Whether the user can still submit answers. The owning AssistantMessage
  // disables the form when the assistant turn is no longer the most recent
  // one (i.e. the user has already moved past it).
  interactive: boolean;
  // Pre-existing answers — when we detect a follow-up user message that
  // begins with "[form answers — <id>]", we parse it back out and pass it
  // here so the rendered form reflects what was sent.
  submittedAnswers?: Record<string, string | string[]>;
  // When the form lives in the Questions tab the Continue button owns the
  // submit, so hide the form's own footer button and report ready-state out.
  hideInternalSubmit?: boolean;
  draftAnswers?: Record<string, string | string[]>;
  onReadyChange?: (ready: boolean) => void;
  onDraftChange?: (answers: Record<string, string | string[]>) => void;
  // Fires on each real user interaction with a single question (locked forms
  // never reach it). Lets the Questions tab host track chip picks.
  onAnswerChange?: (questionId: string, value: string | string[]) => void;
  onSubmit?: (text: string, answers: Record<string, string | string[]>) => void;
}

// Lets a parent (the Questions tab Continue button) trigger submission.
export interface QuestionFormHandle {
  submit: () => void;
  // Submit with no answers — backs the "skip all" affordance. Every question
  // is optional, so this just records each as "(skipped)" and moves on.
  skipAll: () => void;
}

export const QuestionFormView = forwardRef<QuestionFormHandle, Props>(function QuestionFormView(
  {
    form,
    projectId,
    interactive,
    submittedAnswers,
    hideInternalSubmit = false,
    draftAnswers,
    onReadyChange,
    onDraftChange,
    onAnswerChange,
    onSubmit,
  },
  ref,
) {
  const t = useT();
  const initial = useMemo(
    () => buildInitialState(form, submittedAnswers ?? draftAnswers),
    [form, submittedAnswers, draftAnswers],
  );
  const [answers, setAnswers] = useState<Record<string, string | string[]>>(initial);
  const locked = !interactive || !onSubmit || submittedAnswers !== undefined;
  const currentAnswers = submittedAnswers ?? answers;
  const visibleQuestions = form.questions.filter((question) =>
    isQuestionVisible(question, currentAnswers),
  );

  // When the form streams in question-by-question, backfill state for newly
  // revealed questions without disturbing answers the user already touched.
  useEffect(() => {
    setAnswers((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const q of form.questions) {
        if (next[q.id] !== undefined) continue;
        changed = true;
        if (submittedAnswers && submittedAnswers[q.id] !== undefined) {
          next[q.id] = canonicalizeQuestionValue(q, submittedAnswers[q.id]!);
        } else if (q.defaultValue !== undefined) {
          next[q.id] = canonicalizeQuestionValue(q, q.defaultValue);
        } else {
          next[q.id] = q.type === 'checkbox' ? [] : '';
        }
      }
      return changed ? next : prev;
    });
  }, [form, submittedAnswers]);

  function update(id: string, value: string | string[]) {
    if (locked) return;
    const next = { ...answers, [id]: value };
    setAnswers(next);
    onDraftChange?.(next);
    onAnswerChange?.(id, value);
  }

  function toggleCheckbox(id: string, option: string, maxSelections?: number) {
    if (locked) return;
    const current = Array.isArray(answers[id]) ? (answers[id] as string[]) : [];
    const has = current.includes(option);
    if (!has && maxSelections !== undefined && current.length >= maxSelections) return;
    const next = has ? current.filter((v) => v !== option) : [...current, option];
    const nextAnswers = { ...answers, [id]: next };
    setAnswers(nextAnswers);
    onDraftChange?.(nextAnswers);
  }

  function handleSubmit() {
    if (locked || !onSubmit) return;
    // Block submit until required fields are answered and selection caps hold.
    // skipAll() is the only path that intentionally bypasses this (the new
    // Questions-tab Skip button / countdown).
    if (!ready) return;
    onSubmit(formatFormAnswers({ ...form, questions: visibleQuestions }, answers), answers);
  }

  function handleSkipAll() {
    if (locked || !onSubmit) return;
    const empty: Record<string, string | string[]> = {};
    onSubmit(formatFormAnswers({ ...form, questions: visibleQuestions }, empty), empty);
  }

  // Per-question checkbox selection caps must hold.
  const withinSelectionLimits = visibleQuestions.every((q) => {
    if (q.type !== 'checkbox' || q.maxSelections === undefined) return true;
    const v = currentAnswers[q.id];
    return !Array.isArray(v) || v.length <= q.maxSelections;
  });
  // Required questions must carry a non-empty answer. This gates the standard
  // submit button AND the Questions-tab Continue CTA — only skipAll() bypasses
  // it on purpose. Without this, main-path forms (the discovery router's
  // required taskType/output, the ElevenLabs voice picker) would accept an
  // empty submit and serialize "(skipped)" for fields the rest of the system
  // treats as mandatory.
  const requiredAnswered = visibleQuestions.every((q) => {
    if (q.required !== true) return true;
    const v = currentAnswers[q.id];
    if (q.type === 'interface-spec-manual') return isInterfaceSpecManualDraftReady(v);
    if (Array.isArray(v)) return v.length > 0;
    return typeof v === 'string' && v.trim().length > 0;
  });
  const ready = withinSelectionLimits && requiredAnswered;

  useImperativeHandle(ref, () => ({ submit: handleSubmit, skipAll: handleSkipAll }));
  useEffect(() => {
    onReadyChange?.(!locked && ready);
  }, [onReadyChange, locked, ready]);

  return (
    <div className={`question-form${locked ? ' question-form-locked' : ''}`} data-form-id={form.id}>
      <div className="question-form-head">
        <span className="question-form-icon" aria-hidden>?</span>
        <div className="question-form-titles">
          <div className="question-form-title">{form.title}</div>
          {form.description ? (
            <div className="question-form-desc">{form.description}</div>
          ) : null}
        </div>
        {locked ? <span className="question-form-pill">{t('qf.answered')}</span> : null}
      </div>
      <div className="question-form-body">
        {visibleQuestions.map((q) => {
          const value = currentAnswers[q.id];
          return (
            <div key={q.id} className="qf-field">
              <label className="qf-label">
                <span>{q.label}</span>
                {q.required ? (
                  <span className="qf-required" aria-label={t('qf.required')}>*</span>
                ) : null}
              </label>
              {q.help ? <div className="qf-help">{q.help}</div> : null}
              {q.type === 'radio' && q.options ? (
                <div className="qf-options">
                  {q.options.map((opt) => (
                    <label
                      key={opt.value}
                      className={`qf-chip${value === opt.value ? ' qf-chip-on' : ''}`}
                      title={opt.description}
                    >
                      <input
                        type="radio"
                        name={`${form.id}-${q.id}`}
                        value={opt.value}
                        checked={value === opt.value}
                        disabled={locked}
                        aria-label={opt.label}
                        onChange={() => update(q.id, opt.value)}
                      />
                      <OptionCopy option={opt} />
                    </label>
                  ))}
                </div>
              ) : null}
              {q.type === 'checkbox' && q.options ? (
                <div className="qf-options">
                  {q.options.map((opt) => {
                    const arr = Array.isArray(value) ? value : [];
                    const on = arr.includes(opt.value);
                    const maxed =
                      q.maxSelections !== undefined && !on && arr.length >= q.maxSelections;
                    return (
                      <label
                        key={opt.value}
                        title={opt.description}
                        className={`qf-chip${on ? ' qf-chip-on' : ''}${maxed ? ' qf-chip-disabled' : ''}`}
                      >
                        <input
                          type="checkbox"
                          value={opt.value}
                          checked={on}
                          disabled={locked || maxed}
                          aria-label={opt.label}
                          onChange={() => toggleCheckbox(q.id, opt.value, q.maxSelections)}
                        />
                        <OptionCopy option={opt} />
                      </label>
                    );
                  })}
                </div>
              ) : null}
              {q.type === 'select' && q.options ? (
                <select
                  className="qf-select"
                  value={typeof value === 'string' ? value : ''}
                  disabled={locked}
                  onChange={(e) => update(q.id, e.target.value)}
                >
                  <option value="" disabled>
                    {q.placeholder ?? t('qf.choose')}
                  </option>
                  {q.options.map((opt) => (
                    <option key={opt.value} value={opt.value} title={opt.description}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : null}
              {q.type === 'text' ? (
                <input
                  type="text"
                  className="qf-input"
                  value={typeof value === 'string' ? value : ''}
                  placeholder={q.placeholder}
                  disabled={locked}
                  onChange={(e) => update(q.id, e.target.value)}
                />
              ) : null}
              {q.type === 'textarea' ? (
                <textarea
                  className="qf-textarea"
                  value={typeof value === 'string' ? value : ''}
                  placeholder={q.placeholder}
                  disabled={locked}
                  rows={3}
                  onChange={(e) => update(q.id, e.target.value)}
                />
              ) : null}
              {q.type === 'file' ? (
                q.storage === 'dictionary' ? (
                  <DictionaryUploadInput
                    question={q}
                    projectId={projectId}
                    disabled={locked}
                    value={typeof value === 'string' ? value : ''}
                    onChange={(next) => update(q.id, next)}
                  />
                ) : (
                  <QuestionFileInput
                    question={q}
                    projectId={projectId}
                    disabled={locked}
                    value={typeof value === 'string' ? value : ''}
                    onChange={(next) => update(q.id, next)}
                  />
                )
              ) : null}
              {q.type === 'dictionary' ? (
                <SavedDictionaryInput
                  projectId={projectId}
                  disabled={locked}
                  value={typeof value === 'string' ? value : ''}
                  onChange={(next) => update(q.id, next)}
                />
              ) : null}
              {q.type === 'database-context' ? (
                <DatabaseContextInput
                  question={q}
                  projectId={projectId}
                  disabled={locked}
                  value={typeof value === 'string' ? value : ''}
                  onChange={(next) => update(q.id, next)}
                />
              ) : null}
              {q.type === 'domain-mapping' ? (
                <DomainMappingInput
                  domains={q.domains ?? []}
                  disabled={locked}
                  value={typeof value === 'string' ? value : ''}
                  onChange={(next) => update(q.id, next)}
                />
              ) : null}
              {q.type === 'interface-spec-manual' ? (
                <InterfaceSpecManualInput
                  disabled={locked}
                  projectId={projectId}
                  value={typeof value === 'string' ? value : ''}
                  onChange={(next) => update(q.id, next)}
                />
              ) : null}
              {q.type === 'direction-cards' && q.cards && q.cards.length > 0 ? (
                <div className="qf-direction-cards">
                  {q.cards.map((card) => (
                    <DirectionCardView
                      key={card.id}
                      card={card}
                      formId={form.id}
                      questionId={q.id}
                      selected={value === card.id || value === card.label}
                      disabled={locked}
                      onSelect={() => update(q.id, card.id)}
                    />
                  ))}
                </div>
              ) : null}
              {(q.type === 'radio' || q.type === 'checkbox' || q.type === 'select') && q.options ? (
                <SelectedOptionDetail question={q} value={value} />
              ) : null}
            </div>
          );
        })}
      </div>
      {hideInternalSubmit ? null : (
        <div className="question-form-foot">
          {locked ? (
            <span className="qf-locked-note">
              {submittedAnswers ? t('qf.lockedSubmitted') : t('qf.lockedPrev')}
            </span>
          ) : (
            <span className="qf-hint">{t('qf.hint')}</span>
          )}
          {!locked ? (
            <button
              type="button"
              className="primary"
              onClick={handleSubmit}
              disabled={!ready}
              title={ready ? t('qf.submitTitle') : t('qf.submitDisabledTitle')}
            >
              {form.submitLabel ?? t('qf.submitDefault')}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
});

function QuestionFileInput({
  question,
  projectId,
  disabled,
  value,
  onChange,
}: {
  question: QuestionForm['questions'][number];
  projectId?: string;
  disabled: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File | undefined) {
    if (!file || !projectId || disabled) return;
    setBusy(true);
    setError(null);
    try {
      // The daemon sanitizes leading-dot path segments to `_open-docs` so
      // project uploads cannot create arbitrary hidden files. Keep the form
      // aligned with that persisted path when reopening the project.
      const directory = question.storage === 'dictionary'
        ? '_open-docs/dictionaries'
        : question.storage === 'mapping'
          ? '_open-docs/mappings'
          : '.open-docs/question-inputs';
      const result = await uploadProjectFiles(projectId, [file], directory);
      const uploaded = result.uploaded[0];
      if (!uploaded?.path) {
        throw new Error(result.error ?? result.failed[0]?.error ?? t('qf.fileUploadFailed'));
      }
      onChange(uploaded.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('qf.fileUploadFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (!projectId) return <div className="qf-input-note">{t('qf.fileUnavailable')}</div>;
  return (
    <div className="qf-file-input">
      <input
        type="file"
        accept={question.accept}
        disabled={disabled || busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          void upload(file);
        }}
      />
      <span className="qf-input-note">
        {busy ? t('qf.fileUploading') : value || t('qf.fileLocation')}
      </span>
      {error ? <span className="qf-input-error">{error}</span> : null}
    </div>
  );
}

function SavedDictionaryInput({
  projectId,
  disabled,
  value,
  onChange,
}: {
  projectId?: string;
  disabled: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const [scope, setScope] = useState<'project' | 'library'>('project');
  const [paths, setPaths] = useState<string[]>([]);
  const [libraries, setLibraries] = useState<DictionaryLibraryDetail[]>([]);
  const [selectedDictionary, setSelectedDictionary] = useState<DictionaryLibraryDetail | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [snapshots, setSnapshots] = useState<DictionaryProjectSnapshot[]>([]);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (!projectId) return;
    const [files, libraryItems, projectSnapshots] = await Promise.all([
      fetchProjectFiles(projectId),
      fetchDictionaryLibraries().catch(() => []),
      fetchProjectDictionarySnapshots(projectId).catch(() => []),
    ]);
    setPaths(
      files
        .map((file) => file.path ?? file.name)
        .filter((path) => path.startsWith('_open-docs/dictionaries/')),
    );
    setLibraries(libraryItems.map((item) => ({ ...item, versions: [item.latestVersion] })));
    setSnapshots(projectSnapshots);
  }

  useEffect(() => {
    let cancelled = false;
    if (!projectId) return;
    void refresh().catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : t('qf.dictionaryPreviewFailed'));
    });
    return () => {
      cancelled = true;
    };
  // refresh only needs the project identity. It intentionally does not rerun
  // when selections change, which would clear the dictionary version preview.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function chooseProject(path: string) {
    onChange(path);
    setPreview('');
    setError(null);
    if (!projectId || !path) return;
    const content = await fetchProjectFileText(projectId, path);
    if (content === null) {
      setError(t('qf.dictionaryPreviewFailed'));
      return;
    }
    setPreview(content.slice(0, 1200));
  }

  async function chooseLibrary(dictionaryId: string) {
    setError(null);
    setStatus(null);
    setSelectedDictionary(null);
    setSelectedVersionId('');
    if (!dictionaryId) return;
    try {
      const detail = await fetchDictionaryLibrary(dictionaryId);
      setSelectedDictionary(detail);
      setSelectedVersionId(detail.latestVersion.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('qf.dictionaryPreviewFailed'));
    }
  }

  async function useLibraryVersion() {
    if (!projectId || !selectedDictionary || !selectedVersionId || disabled) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const snapshot = await attachDictionaryToProject(projectId, selectedVersionId);
      setSnapshots((current) => current.some((item) => item.versionId === snapshot.versionId)
        ? current
        : [snapshot, ...current]);
      onChange(snapshot.path);
      setStatus(
        t('qf.dictionaryAttached')
          .replace('{name}', snapshot.dictionaryName)
          .replace('{version}', String(snapshot.version)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t('qf.dictionaryPreviewFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (!projectId) return <div className="qf-input-note">{t('qf.fileUnavailable')}</div>;
  const selectedVersion = selectedDictionary?.versions.find((item) => item.id === selectedVersionId) ?? null;
  const existingSnapshot = selectedVersion
    ? snapshots.find((item) => item.versionId === selectedVersion.id)
    : null;
  return (
    <div className={`qf-dictionary-input ${dictionaryStyles.root}`}>
      <div className={dictionaryStyles.scopeTabs} role="tablist" aria-label={t('qf.dictionaryChoose')}>
        <button type="button" role="tab" aria-selected={scope === 'project'} className={scope === 'project' ? dictionaryStyles.scopeActive : dictionaryStyles.scopeButton} onClick={() => setScope('project')} disabled={disabled}>{t('qf.dictionaryScopeProject')}</button>
        <button type="button" role="tab" aria-selected={scope === 'library'} className={scope === 'library' ? dictionaryStyles.scopeActive : dictionaryStyles.scopeButton} onClick={() => setScope('library')} disabled={disabled}>{t('qf.dictionaryScopeLibrary')}</button>
      </div>

      {scope === 'project' ? (
        <>
          <span className="qf-input-note">{t('qf.dictionaryProjectScopeHint')}</span>
          <select className="qf-select" value={value} disabled={disabled} onChange={(event) => void chooseProject(event.target.value)}>
            <option value="">{t('qf.dictionaryChoose')}</option>
            {paths.map((path) => <option key={path} value={path}>{path.split('/').at(-1)}</option>)}
          </select>
          {paths.length === 0 ? <span className="qf-input-note">{t('qf.dictionaryEmpty')}</span> : null}
          {preview ? <pre className="qf-dictionary-preview">{preview}</pre> : null}
        </>
      ) : (
        <>
          <span className="qf-input-note">{t('qf.dictionaryLibraryScopeHint')}</span>
          <select className="qf-select" value={selectedDictionary?.id ?? ''} disabled={disabled || busy} onChange={(event) => void chooseLibrary(event.target.value)}>
            <option value="">{t('qf.dictionaryChoose')}</option>
            {libraries.map((dictionary) => <option key={dictionary.id} value={dictionary.id}>{dictionary.name} · v{dictionary.latestVersion.version}</option>)}
          </select>
          {libraries.length === 0 ? <span className="qf-input-note">{t('qf.dictionaryLibraryEmpty')}</span> : null}
          {selectedDictionary && selectedVersion ? (
            <div className={dictionaryStyles.libraryDetail}>
              <div className={dictionaryStyles.versionList} aria-label={t('dictionaryLibrary.versions')}>
                {selectedDictionary.versions.map((version) => (
                  <button key={version.id} type="button" className={version.id === selectedVersionId ? dictionaryStyles.versionActive : dictionaryStyles.versionButton} onClick={() => setSelectedVersionId(version.id)} disabled={disabled || busy}>
                    {t('qf.dictionaryVersion').replace('{version}', String(version.version))}
                  </button>
                ))}
              </div>
              <DictionaryPreviewTable preview={selectedVersion.preview} emptyText={t('dictionaryLibrary.previewEmpty')} />
              <button type="button" className="primary" onClick={() => void useLibraryVersion()} disabled={disabled || busy}>{busy ? t('dictionaryLibrary.loading') : t('qf.dictionaryAttach')}</button>
              {existingSnapshot && !status ? <span className={dictionaryStyles.snapshotNote}>{t('qf.dictionaryAttached').replace('{name}', existingSnapshot.dictionaryName).replace('{version}', String(existingSnapshot.version))}</span> : null}
            </div>
          ) : null}
        </>
      )}

      {status ? <span className={dictionaryStyles.status} role="status">{status}</span> : null}
      {error ? <span className="qf-input-error">{error}</span> : null}
    </div>
  );
}

function DictionaryUploadInput({
  question,
  projectId,
  disabled,
  value,
  onChange,
}: {
  question: QuestionForm['questions'][number];
  projectId?: string;
  disabled: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const [target, setTarget] = useState<'project' | 'library' | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [libraryName, setLibraryName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    if (!projectId || !file || !target || disabled) return;
    setBusy(true);
    setError(null);
    try {
      if (target === 'project') {
        const result = await uploadProjectFiles(projectId, [file], '_open-docs/dictionaries');
        const uploaded = result.uploaded[0];
        if (!uploaded?.path) throw new Error(result.error ?? result.failed[0]?.error ?? t('qf.fileUploadFailed'));
        onChange(uploaded.path);
      } else {
        const dictionary = await uploadDictionaryLibrary(file, libraryName.trim() || file.name.replace(/\.[^.]+$/, ''));
        const snapshot = await attachDictionaryToProject(projectId, dictionary.latestVersion.id);
        onChange(snapshot.path);
      }
      setFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('qf.fileUploadFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (!projectId) return <div className="qf-input-note">{t('qf.fileUnavailable')}</div>;
  return (
    <div className={`${dictionaryStyles.root} ${dictionaryStyles.uploadArea}`}>
      <span className="qf-input-note">{t('qf.dictionaryUploadHint')}</span>
      <fieldset className={dictionaryStyles.targetChoices} aria-label={t('qf.dictionaryUploadHint')}>
        <label className={target === 'project' ? dictionaryStyles.targetChoiceActive : dictionaryStyles.targetChoice}>
          <input type="radio" name={`dictionary-upload-target-${question.id}`} checked={target === 'project'} onChange={() => setTarget('project')} disabled={disabled || busy} />
          {t('qf.dictionaryProjectUploadTarget')}
        </label>
        <label className={target === 'library' ? dictionaryStyles.targetChoiceActive : dictionaryStyles.targetChoice}>
          <input type="radio" name={`dictionary-upload-target-${question.id}`} checked={target === 'library'} onChange={() => setTarget('library')} disabled={disabled || busy} />
          {t('qf.dictionaryLibraryUploadTarget')}
        </label>
      </fieldset>
      {target === 'library' ? <label className={dictionaryStyles.nameLabel}>{t('qf.dictionaryLibraryName')}<input value={libraryName} disabled={disabled || busy} onChange={(event) => setLibraryName(event.target.value)} placeholder={t('dictionaryLibrary.namePlaceholder')} /></label> : null}
      {target ? (
        <div className={dictionaryStyles.uploadRow}>
          <input type="file" accept={question.accept ?? '.csv,.json,.xlsx,.xlsm'} disabled={disabled || busy} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          <button type="button" className="secondary" disabled={disabled || busy || !file} onClick={() => void upload()}>{target === 'project' ? t('qf.dictionaryProjectUpload') : t('qf.dictionaryLibraryUpload')}</button>
        </div>
      ) : null}
      {value ? <span className={dictionaryStyles.status}>{value}</span> : null}
      {error ? <span className="qf-input-error">{error}</span> : null}
    </div>
  );
}

function DictionaryPreviewTable({ preview, emptyText }: { preview: DictionaryLibraryDetail['latestVersion']['preview']; emptyText: string }) {
  if (preview.columns.length === 0) return <span className="qf-input-note">{emptyText}</span>;
  return (
    <div className={dictionaryStyles.previewTableWrap}>
      <table className={dictionaryStyles.previewTable}>
        <thead><tr>{preview.columns.map((column, index) => <th key={`${column}-${index}`}>{column || '—'}</th>)}</tr></thead>
        <tbody>{preview.rows.map((row, rowIndex) => <tr key={rowIndex}>{preview.columns.map((_column, columnIndex) => <td key={columnIndex}>{row[columnIndex] ?? ''}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function DomainMappingInput({
  domains,
  disabled,
  value,
  onChange,
}: {
  domains: string[];
  disabled: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const domainSignature = domains.join('\u0000');
  const [selectedDomains, setSelectedDomains] = useState<string[]>(() => initialSelectedDomains(value, domains));
  const [draftMapping, setDraftMapping] = useState<Record<string, DomainMappingValue>>(
    () => parseDomainMapping(value, domains),
  );

  useEffect(() => {
    setSelectedDomains(initialSelectedDomains(value, domains));
    setDraftMapping(parseDomainMapping(value, domains));
    // The signature changes only when the scanned domain set changes. Value
    // changes are handled by the field handlers so deselected drafts survive.
  }, [domainSignature]);

  function emitSelection(nextDomains: string[], nextMapping = draftMapping) {
    onChange(JSON.stringify(projectDomainMapping(nextDomains, nextMapping)));
  }

  function updateSelection(nextDomains: string[]) {
    const unique = domains.filter((domain) => nextDomains.includes(domain));
    setSelectedDomains(unique);
    emitSelection(unique);
  }

  function update(domain: string, field: 'businessCode' | 'owner' | 'note', next: string) {
    const nextMapping = { ...draftMapping, [domain]: { ...draftMapping[domain], [field]: next } };
    setDraftMapping(nextMapping);
    emitSelection(selectedDomains, nextMapping);
  }

  if (domains.length === 0) {
    return <div className="qf-input-note">{t('qf.domainMappingEmpty')}</div>;
  }
  return (
    <div className="qf-domain-mapping-input">
      <div className="qf-domain-mapping-toolbar">
        <span className="qf-input-note" aria-live="polite">
          {selectedDomains.length} / {domains.length}
        </span>
        <div className="qf-domain-mapping-actions">
          <button
            type="button"
            className="qf-domain-mapping-action"
            disabled={disabled || selectedDomains.length === domains.length}
            onClick={() => updateSelection(domains)}
          >
            {t('qf.dbSelectAll')}
          </button>
          <button
            type="button"
            className="qf-domain-mapping-action"
            disabled={disabled || selectedDomains.length === 0}
            onClick={() => updateSelection([])}
          >
            {t('qf.dbClearSelection')}
          </button>
        </div>
      </div>
      <div className="qf-domain-mapping-list" role="group" aria-label="Domain selection">
        {domains.map((domain) => (
          <label key={domain} className="qf-domain-mapping-option">
            <input
              type="checkbox"
              checked={selectedDomains.includes(domain)}
              disabled={disabled}
              onChange={() => updateSelection(
                selectedDomains.includes(domain)
                  ? selectedDomains.filter((entry) => entry !== domain)
                  : [...selectedDomains, domain],
              )}
            />
            <span>{domain}</span>
          </label>
        ))}
      </div>
      {selectedDomains.map((domain) => (
        <fieldset key={domain} className="qf-domain-mapping-group">
          <legend>{domain}</legend>
          <input
            type="text"
            className="qf-input"
            aria-label={`${domain} ${t('qf.domainBusinessCode')}`}
            placeholder={t('qf.domainBusinessCode')}
            value={draftMapping[domain]?.businessCode ?? ''}
            disabled={disabled}
            onChange={(event) => update(domain, 'businessCode', event.target.value)}
          />
          <input
            type="text"
            className="qf-input"
            aria-label={`${domain} ${t('qf.domainOwner')}`}
            placeholder={t('qf.domainOwner')}
            value={draftMapping[domain]?.owner ?? ''}
            disabled={disabled}
            onChange={(event) => update(domain, 'owner', event.target.value)}
          />
          <input
            type="text"
            className="qf-input"
            aria-label={`${domain} ${t('qf.domainNote')}`}
            placeholder={t('qf.domainNote')}
            value={draftMapping[domain]?.note ?? ''}
            disabled={disabled}
            onChange={(event) => update(domain, 'note', event.target.value)}
          />
        </fieldset>
      ))}
    </div>
  );
}

type DomainMappingValue = { businessCode?: string; owner?: string; note?: string };

function initialSelectedDomains(value: string, domains: string[]): string[] {
  if (!value.trim()) return domains;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return domains;
    const input = parsed as Record<string, unknown>;
    return domains.filter((domain) => Object.prototype.hasOwnProperty.call(input, domain));
  } catch {
    return domains;
  }
}

function projectDomainMapping(
  domains: string[],
  mapping: Record<string, DomainMappingValue>,
): Record<string, DomainMappingValue> {
  return Object.fromEntries(domains.map((domain) => [domain, mapping[domain] ?? {}]));
}

function parseDomainMapping(value: string, domains: string[]): Record<string, DomainMappingValue> {
  let parsed: unknown;
  try {
    parsed = value ? JSON.parse(value) : null;
  } catch {
    parsed = null;
  }
  const input = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
  return Object.fromEntries(domains.map((domain) => {
    const entry = input[domain];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [domain, {}];
    const fields = entry as Record<string, unknown>;
    return [domain, {
      businessCode: typeof fields.businessCode === 'string' ? fields.businessCode : '',
      owner: typeof fields.owner === 'string' ? fields.owner : '',
      note: typeof fields.note === 'string' ? fields.note : '',
    }];
  }));
}

type DatabaseTableReference = { schema?: string; table: string };

const DATABASE_REFERENCE_PATTERNS: Array<{ pattern: RegExp; namedTable?: string }> = [
  { pattern: /@Table\s*\((?:(?:[^)]*?\bname\s*=\s*)?["'](?<table>[A-Za-z_][\w$-]*)["']|[^)]*?\bname\s*=\s*["'](?<tableNamed>[A-Za-z_][\w$-]*)["'])[^)]*\)/gi },
  { pattern: /@JoinTable\s*\([^)]*?\bname\s*=\s*["'](?<table>[A-Za-z_][\w$-]*)["']/gi },
  { pattern: /@Entity\s*\(\s*(?:\{[^}]*?\bname\s*:\s*)?["'](?<table>[A-Za-z_][\w$-]*)["']/gi },
  { pattern: /\bdb_table\s*=\s*["'](?<table>[A-Za-z_][\w$-]*)["']/gi },
  { pattern: /\btableName\s*:\s*["'](?<table>[A-Za-z_][\w$-]*)["']/gi },
  { pattern: /\b(?:FROM|JOIN|INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO)\s+(?:(?<schema>[A-Za-z_][\w$-]*)\s*\.)?(?<table>[A-Za-z_][\w$-]*)/gi },
];

const DATABASE_RESERVED_IDENTIFIERS = new Set([
  'DELETE', 'FROM', 'GET', 'INTO', 'PATCH', 'POST', 'PUT', 'SELECT', 'UPDATE',
]);

function parseDatabaseCandidateArtifact(text: string, defaultSchema?: string): DatabaseTableReference[] {
  try {
    const payload = JSON.parse(text) as { candidates?: unknown };
    if (!Array.isArray(payload.candidates)) return [];
    return payload.candidates.flatMap((candidate) => {
      if (candidate == null || typeof candidate !== 'object') return [];
      const value = candidate as { schema?: unknown; table?: unknown };
      if (typeof value.table !== 'string' || !/^[A-Za-z_][\w$-]*$/.test(value.table)) return [];
      const schema = typeof value.schema === 'string' && value.schema.trim()
        ? value.schema.trim()
        : defaultSchema;
      return [{ ...(schema ? { schema } : {}), table: value.table }];
    });
  } catch {
    return [];
  }
}

function inferDatabaseTableReferences(
  files: Array<{ path: string; text: string }>,
  defaultSchema?: string,
): DatabaseTableReference[] {
  const references = new Map<string, DatabaseTableReference>();
  for (const file of files) {
    const lines = file.text.split(/\r?\n/);
    for (const { pattern } of DATABASE_REFERENCE_PATTERNS) {
      for (const match of file.text.matchAll(pattern)) {
        const groups = match.groups ?? {};
        const table = groups.table ?? groups.tableNamed;
        if (!table || DATABASE_RESERVED_IDENTIFIERS.has(table.toUpperCase()) || table.startsWith('__')) continue;
        const line = lines[Math.max(0, file.text.slice(0, match.index ?? 0).split('\n').length - 1)] ?? '';
        const isSqlReference = /FROM|JOIN|INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO/i.test(match[0]);
        if (isSqlReference && !/\.(?:sql|xml|yaml|yml)$/i.test(file.path)
          && !/\b(?:select|insert|update|delete|join|query|sql|execute|raw\s*\()/i.test(line)) continue;
        const schema = groups.schema || defaultSchema;
        const key = `${schema?.toLowerCase() ?? ''}.${table.toLowerCase()}`;
        references.set(key, { ...(schema ? { schema } : {}), table });
      }
    }
  }
  return [...references.values()];
}

function DatabaseContextInput({
  question,
  projectId,
  disabled,
  value,
  onChange,
}: {
  question: QuestionForm['questions'][number];
  projectId?: string;
  disabled: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const [connections, setConnections] = useState<DatabaseConnectionSummary[]>([]);
  const [tables, setTables] = useState<Array<{ schema: string; table: string }>>([]);
  const [selectedSchema, setSelectedSchema] = useState('');
  const [connectionId, setConnectionId] = useState('');
  const [selections, setSelections] = useState<string[]>([]);
  const [inspectConcurrency, setInspectConcurrency] = useState<DatabaseInspectConcurrency>(8);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidateStatus, setCandidateStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const desktopDatabase = getOpenDesignHost()?.database;
    const listPromise = desktopDatabase
      ? desktopDatabase.list()
      : requestJson<{ connections: DatabaseConnectionSummary[] }>('/api/database/connections').then((result) => result.connections ?? []);
    void listPromise
      .then((result) => {
        if (!cancelled) setConnections(result ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function chooseConnection(nextConnectionId: string) {
    setConnectionId(nextConnectionId);
    setSelectedSchema('');
    setSelections([]);
    setTables([]);
    onChange('');
    setError(null);
    setCandidateStatus(null);
    if (!nextConnectionId) return;
    setBusy(true);
    try {
      const desktopDatabase = getOpenDesignHost()?.database;
      const result = desktopDatabase
        ? await desktopDatabase.request({
            action: 'schemas',
            connectionId: nextConnectionId,
            selectedByUser: true,
          }) as DatabaseSchemasResponse
        : await requestJson<DatabaseSchemasResponse>(
            `/api/database/connections/${encodeURIComponent(nextConnectionId)}/schemas?selectedByUser=true`,
          );
      const nextTables = result.tables ?? [];
      setTables(nextTables);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function toggleTable(tableSelection: string) {
    setSelections((current) =>
      current.includes(tableSelection)
        ? current.filter((entry) => entry !== tableSelection)
        : [...current, tableSelection],
    );
    onChange('');
  }

  const schemas = Array.from(new Set(tables.map((entry) => entry.schema))).sort();
  const visibleTables = selectedSchema
    ? tables.filter((entry) => entry.schema === selectedSchema)
    : tables;

  async function findCodeCandidates() {
    if (!projectId) {
      setError(t('qf.dbProjectRequired'));
      return;
    }
    if (visibleTables.length === 0) {
      setCandidateStatus(null);
      setError(t('qf.dbNoTablesForCandidates'));
      return;
    }
    setBusy(true);
    setError(null);
    setCandidateStatus(null);
    try {
      const sourceExtensions = new Set([
        '.cs', '.go', '.java', '.js', '.jsx', '.kt', '.php', '.py', '.rb',
        '.sql', '.ts', '.tsx', '.xml', '.yaml', '.yml',
      ]);
      const skippedDirectories = /(?:^|\/)(?:\.git|\.next|build|coverage|dist|node_modules|target|vendor)(?:\/|$)/i;
      const files = (await fetchProjectFiles(projectId))
        .filter((file) => {
          const path = file.path ?? file.name;
          if (!path || skippedDirectories.test(path)) return false;
          const extension = path.slice(path.lastIndexOf('.')).toLowerCase();
          return sourceExtensions.has(extension) || /(?:^|\/)db-candidates\.json$/i.test(path);
        })
        .slice(0, 240);
      const texts: Array<{ path: string; text: string }> = [];
      for (let index = 0; index < files.length; index += 8) {
        const batch = files.slice(index, index + 8);
        const results = await Promise.all(batch.map(async (file) => {
          const path = file.path ?? file.name;
          if (!path) return null;
          const text = await fetchProjectFileText(projectId, path);
          return text == null ? null : { path, text };
        }));
        texts.push(...results.filter((entry): entry is { path: string; text: string } => entry !== null));
      }

      const references = [
        ...inferDatabaseTableReferences(texts, selectedSchema || undefined),
        ...texts
          .filter((file) => /(?:^|\/)db-candidates\.json$/i.test(file.path))
          .flatMap((file) => parseDatabaseCandidateArtifact(file.text, selectedSchema || undefined)),
      ];
      // Linked working directories are intentionally not exposed through the
      // normal project-file list. Ask the daemon to run the same read-only
      // static scan over those explicitly linked roots as a fallback.
      const linkedResult = await requestJson<{ candidates?: Array<{ schema?: string | null; table?: string }> }>(
        `/api/projects/${encodeURIComponent(projectId)}/database/candidates${selectedSchema ? `?schemas=${encodeURIComponent(selectedSchema)}` : ''}`,
      ).catch(() => ({ candidates: [] }));
      for (const candidate of linkedResult.candidates ?? []) {
        if (typeof candidate.table !== 'string' || !candidate.table) continue;
        references.push({
          ...(typeof candidate.schema === 'string' && candidate.schema ? { schema: candidate.schema } : {}),
          table: candidate.table,
        });
      }
      const matched = visibleTables.filter((entry) => references.some((reference) => (
        reference.table.toLowerCase() === entry.table.toLowerCase()
        && (!reference.schema || reference.schema.toLowerCase() === entry.schema.toLowerCase())
      )));
      setSelections(matched.map((entry) => JSON.stringify([entry.schema, entry.table])));
      onChange('');
      setCandidateStatus(t('qf.dbCandidatesFound', { count: matched.length }));
      if (matched.length === 0) setError(t('qf.dbCandidatesNone'));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function attachSelected() {
    if (!connectionId || selections.length === 0) return;
    if (!projectId) {
      setError(t('qf.dbProjectRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // One broker request covers the exact tables the user selected. The
      // broker treats this form selection as consent and does not ask again.
      const selectedTables = selections
        .map((selection) => parseDatabaseTableSelection(selection))
        .filter((entry): entry is [string, string] => entry !== null)
        .map(([schema, table]) => ({ schema, table }));
      const desktopDatabase = getOpenDesignHost()?.database;
      const request = {
        action: 'inspect' as const,
        connectionId,
        tables: selectedTables,
        limit: question.sampleRows ?? 5,
        concurrency: inspectConcurrency,
        selectedByUser: true,
      };
      const result = desktopDatabase
        ? await desktopDatabase.request(request) as DatabaseInspectResponse
        : await requestJson<DatabaseInspectResponse>(
            `/api/database/connections/${encodeURIComponent(connectionId)}/inspect`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                tables: selectedTables,
                limit: question.sampleRows ?? 5,
                concurrency: inspectConcurrency,
                selectedByUser: true,
              }),
            },
          );
      const failed = (result.tables ?? []).filter((entry) => entry.error);
      const attachedTables = (result.tables ?? [])
        .filter((entry) => !entry.error)
        .map(({ schema, table, columns, sampleRows }) => ({ schema, table, columns, sampleRows }));
      if (failed.length > 0) {
        setError(`${attachedTables.length} tables attached; ${failed.length} tables could not be read.`);
      }
      if (attachedTables.length === 0) throw new Error('No selected tables could be read.');
      const connection = connections.find((candidate) => candidate.id === connectionId);
      const contextPath = '.open-docs/database-context/approved-db-context.json';
      const context = {
        source: 'desktop-database-broker',
        connectionId,
        connection: connection?.label ?? connectionId,
        tables: attachedTables,
      };
      const saved = await writeProjectTextFile(projectId, contextPath, JSON.stringify(context, null, 2));
      if (!saved) throw new Error('Could not save the approved database context to the project.');
      onChange(
        JSON.stringify({
          source: 'desktop-database-broker',
          connectionId,
          connection: connection?.label ?? connectionId,
          contextFile: contextPath,
          tables: attachedTables.map(({ schema, table }) => ({ schema, table })),
        }),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="qf-database-input">
      <select
        className="qf-select"
        value={connectionId}
        disabled={disabled || busy}
        onChange={(event) => void chooseConnection(event.target.value)}
      >
        <option value="">{t('qf.dbChooseConnection')}</option>
        {connections.map((connection) => (
          <option key={connection.id} value={connection.id}>
            {connection.label} ({connection.host}/{connection.database})
          </option>
        ))}
      </select>
      {connections.length === 0 && !error ? <span className="qf-input-note">{t('qf.dbNoConnections')}</span> : null}
      {connectionId ? (
        <>
          {schemas.length > 0 ? (
            <select
              className="qf-select"
              aria-label={t('qf.dbChooseSchema')}
              value={selectedSchema}
              disabled={disabled || busy}
              onChange={(event) => {
                setSelectedSchema(event.target.value);
                setCandidateStatus(null);
                onChange('');
              }}
            >
              <option value="">{t('qf.dbAllSchemas')}</option>
              {schemas.map((schema) => <option key={schema} value={schema}>{schema}</option>)}
            </select>
          ) : null}
          <div className="qf-db-table-list" aria-label={t('qf.dbChooseTable')}>
            {visibleTables.map((entry) => (
              <label key={`${entry.schema}.${entry.table}`} className="qf-db-table-option">
                <input
                  type="checkbox"
                  checked={selections.includes(JSON.stringify([entry.schema, entry.table]))}
                  disabled={disabled || busy}
                  onChange={() => toggleTable(JSON.stringify([entry.schema, entry.table]))}
                />
                <span>{entry.schema}.{entry.table}</span>
              </label>
            ))}
          </div>
          <label>
            <span>{t('qf.dbConcurrency')}</span>
            <select
              className="qf-select"
              aria-label={t('qf.dbConcurrency')}
              value={String(inspectConcurrency)}
              disabled={disabled || busy}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (next === 8 || next === 16 || next === 32) {
                  setInspectConcurrency(next);
                  onChange('');
                }
              }}
            >
              <option value="8">8</option>
              <option value="16">16</option>
              <option value="32">32</option>
            </select>
          </label>
          <span className="qf-input-note">{t('qf.dbConcurrencyHint')}</span>
          <div className="qf-db-table-actions">
            <button
              type="button"
              className="qf-db-table-action"
              disabled={disabled || busy || visibleTables.length === 0}
              onClick={() => {
                const visibleSelections = visibleTables.map((entry) => JSON.stringify([entry.schema, entry.table]));
                setSelections((current) => Array.from(new Set([...current, ...visibleSelections])));
                onChange('');
              }}
            >
              {selectedSchema ? t('qf.dbSelectSchemaAll') : t('qf.dbSelectAll')}
            </button>
            <button
              type="button"
              className="qf-db-table-action"
              disabled={disabled || busy || selections.length === 0}
              onClick={() => {
                setSelections([]);
                onChange('');
              }}
            >
              {t('qf.dbClearSelection')}
            </button>
            <button
              type="button"
              className="qf-db-table-action"
              disabled={disabled || busy || visibleTables.length === 0}
              onClick={() => void findCodeCandidates()}
            >
              {busy ? t('qf.dbFindingCandidates') : t('qf.dbFindCandidates')}
            </button>
          </div>
          {candidateStatus ? <span className="qf-input-note">{candidateStatus}</span> : null}
          <button
            type="button"
            className="qf-db-attach"
            disabled={disabled || busy || selections.length === 0}
            onClick={() => void attachSelected()}
          >
            {busy ? t('qf.dbLoading') : t('qf.dbAttachSelected', { count: selections.length })}
          </button>
        </>
      ) : null}
      {value ? (
        <span className="qf-input-note">
          {t('qf.dbAttached')}
        </span>
      ) : null}
      {error ? <span className="qf-input-error">{error}</span> : null}
    </div>
  );
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | T | null;
  if (!response.ok) {
    throw new Error(
      body && typeof body === 'object' && 'error' in body
        ? body.error?.message ?? `Request failed (${response.status})`
        : `Request failed (${response.status})`,
    );
  }
  return body as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseDatabaseTableSelection(value: string): [string, string] | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.length === 2 && parsed.every((part) => typeof part === 'string')
      ? [parsed[0] as string, parsed[1] as string]
      : null;
  } catch {
    return null;
  }
}

function OptionCopy({ option }: { option: FormOption }) {
  return (
    <span className="qf-chip-copy">
      <span>{option.label}</span>
    </span>
  );
}

function SelectedOptionDetail({
  question,
  value,
}: {
  question: QuestionForm['questions'][number];
  value: string | string[] | undefined;
}) {
  const selected = (Array.isArray(value) ? value : value ? [value] : [])
    .map((entry) => question.options?.find((option) => option.value === entry))
    .filter((option): option is FormOption => option !== undefined)
    .filter((option) => option.description || option.example);
  if (selected.length === 0) return null;
  return (
    <div className="qf-option-details">
      {selected.map((option) => (
        <div key={option.value} className="qf-option-detail">
          {option.description ? <div>{option.description}</div> : null}
          {option.example ? <code>{option.example}</code> : null}
        </div>
      ))}
    </div>
  );
}

function isQuestionVisible(
  question: QuestionForm['questions'][number],
  answers: Record<string, string | string[]>,
): boolean {
  if (!question.showWhen) return true;
  const selected = answers[question.showWhen.questionId];
  const values = Array.isArray(selected) ? selected : selected ? [selected] : [];
  return values.some((value) => question.showWhen?.values.includes(value));
}

function DirectionCardView({
  card,
  formId,
  questionId,
  selected,
  disabled,
  onSelect,
}: {
  card: DirectionCard;
  formId: string;
  questionId: string;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const t = useT();
  return (
    <label
      className={`qf-card${selected ? ' qf-card-on' : ''}${disabled ? ' qf-card-disabled' : ''}`}
    >
      <input
        type="radio"
        name={`${formId}-${questionId}`}
        value={card.id}
        checked={selected}
        disabled={disabled}
        onChange={() => onSelect()}
      />
      <div className="qf-card-head">
        <div className="qf-card-title">{card.label}</div>
        {selected ? <span className="qf-card-pill">{t('qf.cardSelected')}</span> : null}
      </div>
      {card.palette.length > 0 ? (
        <div className="qf-card-swatches" aria-hidden>
          {card.palette.slice(0, 6).map((c, i) => (
            <span
              key={i}
              className="qf-card-swatch"
              style={{ background: c }}
              title={c}
            />
          ))}
        </div>
      ) : null}
      <div className="qf-card-types" aria-hidden>
        <span className="qf-card-type-display" style={{ fontFamily: card.displayFont }}>
          Aa
        </span>
        <span className="qf-card-type-body" style={{ fontFamily: card.bodyFont }}>
          {t('qf.cardSampleText')}
        </span>
      </div>
      {card.mood ? <p className="qf-card-mood">{card.mood}</p> : null}
      {card.references.length > 0 ? (
        <p className="qf-card-refs">
          <span className="qf-card-refs-label">{t('qf.cardRefs')}</span>{' '}
          {card.references.slice(0, 4).join(' · ')}
        </p>
      ) : null}
    </label>
  );
}

function buildInitialState(
  form: QuestionForm,
  submitted: Record<string, string | string[]> | undefined,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const q of form.questions) {
    if (submitted && submitted[q.id] !== undefined) {
      out[q.id] = canonicalizeQuestionValue(q, submitted[q.id]!);
      continue;
    }
    if (q.defaultValue !== undefined) {
      out[q.id] = canonicalizeQuestionValue(q, q.defaultValue);
      continue;
    }
    if (q.type === 'checkbox') {
      out[q.id] = [];
    } else {
      out[q.id] = '';
    }
  }
  return out;
}

function canonicalizeQuestionValue(
  q: QuestionForm['questions'][number],
  value: string | string[],
): string | string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => formOptionValueForLabel(q, entry));
  }
  return formOptionValueForLabel(q, value);
}

/**
 * Reverse of formatFormAnswers — when we render an old assistant message
 * that contained a form, look at the next user message in the conversation
 * to see if the form was already answered. If so, return the answers map
 * so the form renders in the locked "answered" state with the user's
 * picks visible.
 */
export function parseSubmittedAnswers(
  form: QuestionForm,
  userMessageContent: string,
): Record<string, string | string[]> | null {
  const lines = userMessageContent.split('\n').map((l) => l.trim());
  if (lines.length === 0) return null;
  const header = lines[0] ?? '';
  // We accept any "form answers" header so the agent can paraphrase.
  if (!/^\[form answers/i.test(header)) return null;
  const answers: Record<string, string | string[]> = {};
  const labelToId = new Map<string, string>();
  for (const q of form.questions) labelToId.set(q.label.toLowerCase(), q.id);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const m = /^[-*]\s*([^:]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const labelKey = m[1]!.trim().toLowerCase();
    const value = m[2]!.trim();
    const id = labelToId.get(labelKey);
    if (!id) continue;
    const q = form.questions.find((x) => x.id === id);
    if (!q) continue;
    if (q.type === 'checkbox') {
      answers[id] = value
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.toLowerCase() !== '(skipped)')
        .map((s) => formOptionValueForLabel(q, parseSubmittedOptionToken(s)));
    } else {
      answers[id] = value.toLowerCase() === '(skipped)' ? '' : formOptionValueForLabel(q, parseSubmittedOptionToken(value));
    }
  }
  return Object.keys(answers).length > 0 ? answers : null;
}

function parseSubmittedOptionToken(raw: string): string {
  const match = /\s+\[value:\s*([^\]]+)\]\s*$/i.exec(raw);
  if (!match) return raw.trim();
  return match[1]!.trim();
}
