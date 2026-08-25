'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  InterfaceEndpoint,
  InterfaceFieldSpec,
  InterfaceSpecDocument,
  InterfaceSpecTemplatePreset,
  ProjectFile,
} from '@open-design/contracts';
import { parseInterfaceSpecDocument, validateInterfaceSpecDocument } from '@open-design/contracts';
import type { ArtifactManifest } from '../../artifacts/types';
import { useI18n } from '../../i18n';
import { fetchProjectFileText, writeProjectTextFileDetailed } from '../../providers/registry';
import { DocumentRenderActions } from '../document-spec/DocumentRenderActions';
import styles from './InterfaceSpecEditor.module.css';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const AUTH_TYPES = ['undecided', 'none', 'bearer', 'api-key', 'session-cookie', 'custom'] as const;

type Props = {
  projectId: string;
  file: ProjectFile;
  onFileSaved?: () => Promise<void> | void;
  onOpenFile?: (name: string) => void;
};

function emptyField(): InterfaceFieldSpec {
  return { nameEn: '', nameKo: '', dataType: 'String', required: 'TBD', minSize: '', maxSize: '', note: '', depth: 0 };
}

function nextInterfaceId(endpoints: InterfaceEndpoint[]): string {
  const used = new Set(endpoints.map((endpoint) => endpoint.interfaceId.toUpperCase()));
  let index = endpoints.length + 1;
  while (used.has(`IF-NEW-${String(index).padStart(3, '0')}`)) index += 1;
  return `IF-NEW-${String(index).padStart(3, '0')}`;
}

function emptyEndpoint(endpoints: InterfaceEndpoint[]): InterfaceEndpoint {
  return {
    method: 'GET',
    path: '/api/new-endpoint',
    interfaceId: nextInterfaceId(endpoints),
    interfaceName: 'New interface',
    businessCode: '',
    channel: '',
    owner: '',
    note: '',
    moduleName: '',
    serviceName: '',
    handlerName: '',
    sourceFile: '',
    authRequired: false,
    requestFields: [],
    responseFields: [],
  };
}

export function InterfaceSpecEditor({ projectId, file, onFileSaved, onOpenFile }: Props) {
  const { locale, t } = useI18n();
  const ko = locale === 'ko';
  const copy = ko ? KO_COPY : EN_COPY;
  const [doc, setDoc] = useState<InterfaceSpecDocument | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [endpointIndex, setEndpointIndex] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [diskChanged, setDiskChanged] = useState(false);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  const load = useCallback(async () => {
    const text = await fetchProjectFileText(projectId, file.name, { cache: 'no-store' });
    if (text == null) throw new Error(copy.loadFailed);
    const parsed = parseInterfaceSpecDocument(JSON.parse(text));
    if (!parsed.ok) throw new Error(parsed.error);
    setDoc(parsed.doc);
    setDirty(false);
    setDiskChanged(false);
    setEndpointIndex((current) => Math.min(current, Math.max(0, parsed.doc.endpoints.length - 1)));
  }, [copy.loadFailed, file.name, projectId]);

  useEffect(() => {
    if (dirtyRef.current) {
      setDiskChanged(true);
      return;
    }
    setPhase('loading');
    void load().then(() => setPhase('ready')).catch((error) => {
      setLoadError(error instanceof Error ? error.message : String(error));
      setPhase('error');
    });
  }, [file.mtime, file.name, load, projectId, reloadKey]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const issues = useMemo(() => doc ? validateInterfaceSpecDocument(doc) : [], [doc]);
  const fatalIssues = issues.filter((issue) => issue.severity === 'fatal');
  const warningIssues = issues.filter((issue) => issue.severity === 'warning');

  function mutate(update: (current: InterfaceSpecDocument) => InterfaceSpecDocument) {
    setDoc((current) => current ? update(current) : current);
    setDirty(true);
    setSaved(false);
  }

  function patchEndpoint(patch: Partial<InterfaceEndpoint>) {
    mutate((current) => ({
      ...current,
      endpoints: current.endpoints.map((endpoint, index) => index === endpointIndex ? { ...endpoint, ...patch } : endpoint),
    }));
  }

  function patchField(
    kind: 'requestFields' | 'responseFields',
    fieldIndex: number,
    patch: Partial<InterfaceFieldSpec>,
  ) {
    if (!doc) return;
    const endpoint = doc.endpoints[endpointIndex];
    if (!endpoint) return;
    patchEndpoint({
      [kind]: endpoint[kind].map((field, index) => index === fieldIndex ? { ...field, ...patch } : field),
    });
  }

  async function save(): Promise<boolean> {
    if (!doc || saving) return false;
    setSaving(true);
    setSaveError('');
    const manifest: ArtifactManifest = {
      version: 1,
      kind: 'interface-spec',
      renderer: 'interface-spec',
      title: doc.cover.docName || doc.source.codebaseName,
      entry: file.name,
      status: 'complete',
      exports: ['xlsx', 'txt', 'zip'],
      sourceSkillId: file.artifactManifest?.sourceSkillId,
      designSystemId: file.artifactManifest?.designSystemId,
    };
    const result = await writeProjectTextFileDetailed(projectId, file.name, JSON.stringify(doc, null, 2), { artifactManifest: manifest });
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.message);
      return false;
    }
    setDirty(false);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
    await onFileSaved?.();
    return true;
  }

  if (phase === 'loading') return <div className="viewer"><div className="viewer-body"><div className="viewer-empty">{t('common.loading')}</div></div></div>;
  if (phase === 'error' || !doc) return (
    <div className="viewer"><div className="viewer-body"><div className={styles.centerError}><p>{loadError || copy.loadFailed}</p><button className="viewer-action" type="button" onClick={() => setReloadKey((value) => value + 1)}>{copy.reload}</button></div></div></div>
  );

  const endpoint = doc.endpoints[endpointIndex];
  return (
    <div className={`viewer ${styles.root}`}>
      <div className="viewer-toolbar">
        <div className={styles.endpointTabs}>
          {doc.endpoints.map((item, index) => (
            <button className={`${styles.endpointTab} ${index === endpointIndex ? styles.active : ''}`} key={`${item.method}-${item.path}-${index}`} type="button" onClick={() => setEndpointIndex(index)}>
              <strong>{item.interfaceId || `${index + 1}`}</strong><span>{item.interfaceName || `${item.method} ${item.path}`}</span>
            </button>
          ))}
          <button className={styles.addTab} type="button" title={copy.addEndpoint} onClick={() => {
            mutate((current) => ({ ...current, endpoints: [...current.endpoints, emptyEndpoint(current.endpoints)] }));
            setEndpointIndex(doc.endpoints.length);
          }}>+</button>
        </div>
        <div className="viewer-toolbar-actions">
          <button className="viewer-action" type="button" onClick={() => {
            if (dirty && !window.confirm(copy.discardChanges)) return;
            setDirty(false);
            setReloadKey((value) => value + 1);
          }}>{copy.reload}</button>
          <DocumentRenderActions projectId={projectId} inputFile={file.name} kind="interface-spec" dirty={dirty} fatalCount={fatalIssues.length} onSave={save} onRefresh={onFileSaved} onOpenFile={onOpenFile} />
          <button className="viewer-action" type="button" disabled={!dirty || saving} onClick={() => void save()}>{saving ? copy.saving : saved ? copy.saved : t('common.save')}</button>
        </div>
      </div>

      <div className={`viewer-body ${styles.body}`}>
        {diskChanged ? <div className={styles.notice}>{copy.diskChanged}<button type="button" onClick={() => { setDirty(false); setReloadKey((value) => value + 1); }}>{copy.reloadDisk}</button></div> : null}
        {saveError ? <div className={styles.error} role="alert">{saveError}</div> : null}
        {fatalIssues.length > 0 ? <IssueList title={copy.fatal(fatalIssues.length)} tone="fatal" issues={fatalIssues.map((issue) => issue.message)} /> : null}
        {warningIssues.length > 0 ? <IssueList title={copy.warnings(warningIssues.length)} tone="warning" issues={warningIssues.map((issue) => issue.message)} /> : null}

        <section className={styles.documentPanel}>
          <div className={styles.sectionHeading}><div><h3>{copy.documentInfo}</h3><p>{copy.source}: {doc.source.mode === 'manual' ? copy.manualSource : [doc.source.language, doc.source.framework, doc.source.codebaseName].filter(Boolean).join(' · ')}</p></div></div>
          <div className={styles.documentGrid}>
            <Field label={copy.documentName}><input value={doc.cover.docName} onChange={(event) => mutate((current) => ({ ...current, cover: { ...current.cover, docName: event.target.value } }))} /></Field>
            <Field label={copy.version}><input value={doc.cover.version} onChange={(event) => mutate((current) => ({ ...current, cover: { ...current.cover, version: event.target.value } }))} /></Field>
            <Field label={copy.department}><input value={doc.cover.department} onChange={(event) => mutate((current) => ({ ...current, cover: { ...current.cover, department: event.target.value } }))} /></Field>
            <Field label={copy.template}><select value={doc.templatePreset} onChange={(event) => mutate((current) => ({ ...current, templatePreset: event.target.value as InterfaceSpecTemplatePreset }))}><option value="si-standard">{copy.standardTemplate}</option><option value="compact">{copy.compactTemplate}</option><option value="review">{copy.reviewTemplate}</option></select></Field>
          </div>
        </section>

        {endpoint ? (
          <section className={styles.endpointPanel}>
            <div className={styles.sectionHeading}>
              <div><h3>{copy.endpoint} {endpointIndex + 1}</h3><p><code>{endpoint.method} {endpoint.path}</code></p></div>
              {doc.endpoints.length > 1 ? <button className={styles.dangerButton} type="button" onClick={() => {
                if (!window.confirm(copy.deleteEndpointConfirm)) return;
                mutate((current) => ({ ...current, endpoints: current.endpoints.filter((_item, index) => index !== endpointIndex) }));
                setEndpointIndex((value) => Math.max(0, value - 1));
              }}>{copy.deleteEndpoint}</button> : null}
            </div>
            <div className={styles.endpointGrid}>
              <Field label={copy.interfaceId}><input value={endpoint.interfaceId} onChange={(event) => patchEndpoint({ interfaceId: event.target.value.toUpperCase() })} /></Field>
              <Field label={copy.interfaceName}><input value={endpoint.interfaceName} onChange={(event) => patchEndpoint({ interfaceName: event.target.value })} /></Field>
              <Field label={copy.method}><select value={endpoint.method} onChange={(event) => patchEndpoint({ method: event.target.value })}>{METHODS.map((method) => <option value={method} key={method}>{method}</option>)}</select></Field>
              <Field label={copy.path}><input value={endpoint.path} onChange={(event) => patchEndpoint({ path: event.target.value })} /></Field>
              <Field label={copy.auth}><select value={endpoint.authRequired ? endpoint.auth?.type ?? 'undecided' : 'none'} onChange={(event) => {
                const type = event.target.value as (typeof AUTH_TYPES)[number];
                patchEndpoint({ authRequired: type !== 'none', auth: type === 'none' ? undefined : { type } });
              }}>{AUTH_TYPES.map((type) => <option value={type} key={type}>{type}</option>)}</select></Field>
              <Field label={copy.owner}><input value={endpoint.owner} onChange={(event) => patchEndpoint({ owner: event.target.value })} /></Field>
              <Field label={copy.businessCode}><input value={endpoint.businessCode} onChange={(event) => patchEndpoint({ businessCode: event.target.value })} /></Field>
              <Field label={copy.note}><input value={endpoint.note} onChange={(event) => patchEndpoint({ note: event.target.value })} /></Field>
            </div>
            <FieldTable copy={copy} title="REQUEST" fields={endpoint.requestFields} onAdd={() => patchEndpoint({ requestFields: [...endpoint.requestFields, emptyField()] })} onDelete={(index) => patchEndpoint({ requestFields: endpoint.requestFields.filter((_field, fieldIndex) => fieldIndex !== index) })} onPatch={(index, patch) => patchField('requestFields', index, patch)} />
            <FieldTable copy={copy} title="RESPONSE" fields={endpoint.responseFields} onAdd={() => patchEndpoint({ responseFields: [...endpoint.responseFields, emptyField()] })} onDelete={(index) => patchEndpoint({ responseFields: endpoint.responseFields.filter((_field, fieldIndex) => fieldIndex !== index) })} onPatch={(index, patch) => patchField('responseFields', index, patch)} />
          </section>
        ) : <div className={styles.empty}><p>{copy.noEndpoints}</p><button type="button" onClick={() => mutate((current) => ({ ...current, endpoints: [emptyEndpoint([])] }))}>{copy.addEndpoint}</button></div>}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className={styles.field}><span>{label}</span>{children}</label>;
}

function IssueList({ title, tone, issues }: { title: string; tone: 'fatal' | 'warning'; issues: string[] }) {
  return <details className={`${styles.issues} ${tone === 'fatal' ? styles.issuesFatal : ''}`} open={tone === 'fatal'}><summary>{title}</summary><ul>{issues.map((issue, index) => <li key={`${issue}-${index}`}>{issue}</li>)}</ul></details>;
}

type EditorCopy = typeof EN_COPY & {
  fatal: (count: number) => string;
  warnings: (count: number) => string;
};

function FieldTable({ title, fields, onAdd, onDelete, onPatch, copy }: { title: string; fields: InterfaceFieldSpec[]; onAdd: () => void; onDelete: (index: number) => void; onPatch: (index: number, patch: Partial<InterfaceFieldSpec>) => void; copy: EditorCopy }) {
  return <div className={styles.fieldSection}>
    <div className={styles.fieldSectionHead}><div><h4>{title}</h4><p>{copy.sizeHint}</p></div><button type="button" onClick={onAdd}>+ {copy.addField}</button></div>
    {fields.length === 0 ? <div className={styles.emptyFields}>{copy.emptyFields}</div> : <div className={styles.tableWrap}><table><thead><tr><th>{copy.fieldNameEn}</th><th>{copy.fieldNameKo}</th><th>{copy.dataType}</th><th>{copy.min}</th><th>{copy.max}</th><th>{copy.required}</th><th>{copy.note}</th><th /></tr></thead><tbody>{fields.map((field, index) => <tr key={`${field.path ?? field.nameEn}-${index}`}>
      <td><input aria-label={`${title} ${index + 1} ${copy.fieldNameEn}`} value={field.nameEn} onChange={(event) => onPatch(index, { nameEn: event.target.value })} /></td>
      <td><input value={field.nameKo} onChange={(event) => onPatch(index, { nameKo: event.target.value })} /></td>
      <td><input value={field.dataType} onChange={(event) => onPatch(index, { dataType: event.target.value })} /></td>
      <td><input value={field.minSize} onChange={(event) => onPatch(index, { minSize: event.target.value })} /></td>
      <td><input value={field.maxSize} onChange={(event) => onPatch(index, { maxSize: event.target.value })} /></td>
      <td><select value={field.required} onChange={(event) => onPatch(index, { required: event.target.value as InterfaceFieldSpec['required'] })}><option value="TBD">TBD</option><option value="Y">Y</option><option value="N">N</option></select></td>
      <td><input value={field.note} onChange={(event) => onPatch(index, { note: event.target.value })} /></td>
      <td><button aria-label={`${title} ${index + 1} ${copy.delete}`} type="button" onClick={() => onDelete(index)}>×</button></td>
    </tr>)}</tbody></table></div>}
  </div>;
}

const EN_COPY = {
  loadFailed: 'Could not load the interface specification.', reload: 'Reload', saving: 'Saving…', saved: 'Saved', discardChanges: 'Discard unsaved changes and reload?', diskChanged: 'This file changed on disk while you were editing.', reloadDisk: 'Reload disk version', documentInfo: 'Document & template', source: 'Source', manualSource: 'Requirements-based manual design', documentName: 'Document name', version: 'Version', department: 'Department', template: 'Workbook template', standardTemplate: 'SI Standard (recommended)', compactTemplate: 'Compact', reviewTemplate: 'Review emphasis', endpoint: 'Interface', addEndpoint: 'Add interface', deleteEndpoint: 'Delete interface', deleteEndpointConfirm: 'Delete this interface?', interfaceId: 'Interface ID', interfaceName: 'Interface name', method: 'Method', path: 'Path', auth: 'Authentication', owner: 'Owner', businessCode: 'Business code', note: 'Notes', sizeHint: 'Min/max is string length or collection item count; leave blank when unknown.', addField: 'Add field', emptyFields: 'No fields. Leave this empty when the message has no body.', fieldNameEn: 'English name', fieldNameKo: 'Korean name', dataType: 'Type', min: 'Min', max: 'Max', required: 'Required', noEndpoints: 'Add at least one interface before export.', delete: 'Delete', fatal: (count: number) => `${count} fatal issue(s) block export`, warnings: (count: number) => `${count} item(s) need review`,
};

const KO_COPY: EditorCopy = {
  loadFailed: '인터페이스 명세서를 불러오지 못했습니다.', reload: '다시 불러오기', saving: '저장 중…', saved: '저장됨', discardChanges: '저장하지 않은 변경사항을 버리고 다시 불러올까요?', diskChanged: '편집 중 파일이 외부에서 변경되었습니다.', reloadDisk: '디스크 버전 불러오기', documentInfo: '문서·템플릿', source: '생성 근거', manualSource: '요구사항 기반 신규 설계', documentName: '문서명', version: '버전', department: '관리 부서', template: '엑셀 템플릿', standardTemplate: '기본 SI 표준 (권장)', compactTemplate: '컴팩트', reviewTemplate: '리뷰 강조', endpoint: '인터페이스', addEndpoint: '인터페이스 추가', deleteEndpoint: '인터페이스 삭제', deleteEndpointConfirm: '이 인터페이스를 삭제할까요?', interfaceId: '인터페이스 ID', interfaceName: '인터페이스명', method: 'Method', path: 'Path', auth: '인증', owner: '담당자', businessCode: '업무 코드', note: '비고', sizeHint: '최소·최대는 문자열 길이 또는 배열 항목 수입니다. 모르면 비워 둘 수 있습니다.', addField: '필드 추가', emptyFields: '필드가 없습니다. 본문이 없는 메시지라면 그대로 둘 수 있습니다.', fieldNameEn: '영문명', fieldNameKo: '한글명', dataType: '타입', min: '최소', max: '최대', required: '필수', noEndpoints: '내보내기 전에 인터페이스를 한 개 이상 추가하세요.', delete: '삭제', fatal: (count: number) => `내보내기를 막는 오류 ${count}건`, warnings: (count: number) => `검토 권장 ${count}건`,
};
