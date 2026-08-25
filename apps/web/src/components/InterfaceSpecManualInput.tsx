import { useMemo, useState } from 'react';
import type {
  InterfaceSpecManualAssistMode,
  InterfaceSpecManualDraft,
  InterfaceSpecManualEndpointDraft,
  InterfaceSpecManualFieldDraft,
  InterfaceSpecManualFieldMode,
  InterfaceSpecManualReferenceFile,
  InterfaceSpecManualReferenceRole,
  InterfaceSpecManualTemplate,
} from '../artifacts/question-form';
import { parseInterfaceSpecManualDraft } from '../artifacts/question-form';
import { uploadProjectFiles } from '../providers/registry';
import styles from './InterfaceSpecManualInput.module.css';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const REFERENCE_ACCEPT = '.xlsx,.xlsm,.csv,.json,.yaml,.yml,.pdf,.docx,.pptx,.md,.txt,.png,.jpg,.jpeg';

const REFERENCE_ROLES: Array<{ value: InterfaceSpecManualReferenceRole; label: string }> = [
  { value: 'requirements', label: '요구사항·기획 문서' },
  { value: 'sample', label: '요청·응답 샘플' },
  { value: 'dictionary', label: '용어사전' },
  { value: 'api-standard', label: 'API 표준·OpenAPI' },
  { value: 'output-template', label: '엑셀 출력 템플릿' },
  { value: 'other', label: '기타 참고자료' },
];

const TEMPLATE_OPTIONS: Array<{
  id: InterfaceSpecManualTemplate;
  name: string;
  description: string;
  recommended?: boolean;
}> = [
  {
    id: 'si-standard',
    name: '기본 SI 표준',
    description: '현재 MonoField 기본 XLSX 형식입니다.',
    recommended: true,
  },
  { id: 'compact', name: '컴팩트', description: '회색 계열로 밀도 높게 검토합니다.' },
  { id: 'review', name: '리뷰 강조', description: '확인할 항목이 잘 보이는 노란색 계열입니다.' },
];

function emptyDraft(): InterfaceSpecManualDraft {
  return {
    documentName: '',
    version: '1.0',
    department: '',
    assistMode: 'ai',
    reviewStage: 'intake',
    businessContext: '',
    referenceFiles: [],
    templatePreset: 'si-standard',
    endpoints: [emptyEndpoint('endpoint-1')],
  };
}

function emptyEndpoint(id: string): InterfaceSpecManualEndpointDraft {
  return {
    id,
    interfaceName: '',
    interfaceId: '',
    method: '',
    path: '',
    auth: 'undecided',
    businessPurpose: '',
    requestMode: 'ai',
    responseMode: 'ai',
    requestFields: [],
    responseFields: [],
  };
}

function emptyField(id: string): InterfaceSpecManualFieldDraft {
  return {
    id,
    nameEn: '',
    nameKo: '',
    dataType: '',
    minSize: '',
    maxSize: '',
    required: 'TBD',
    note: '',
    evidence: '',
  };
}

function readDraft(value: string): InterfaceSpecManualDraft {
  if (!value.trim()) return emptyDraft();
  try {
    return parseInterfaceSpecManualDraft(JSON.parse(value)) ?? emptyDraft();
  } catch {
    return emptyDraft();
  }
}

export function isInterfaceSpecManualDraftReady(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false;
  const draft = readDraft(value);
  if (!draft.documentName.trim() || draft.endpoints.length === 0) return false;
  const keys = new Set<string>();
  for (const endpoint of draft.endpoints) {
    if (!endpoint.interfaceName.trim() || !endpoint.method.trim() || !endpoint.path.trim()) return false;
    const key = `${endpoint.method.toUpperCase()} ${endpoint.path.trim()}`;
    if (keys.has(key)) return false;
    keys.add(key);
    if ([...endpoint.requestFields, ...endpoint.responseFields].some((field) => !field.nameEn.trim())) {
      return false;
    }
  }
  if (draft.reviewStage === 'review') {
    const hasUnreviewedSuggestion = draft.endpoints.some((endpoint) =>
      (endpoint.requestMode !== 'none' && endpoint.requestFields.some((field) => field.suggested === true)) ||
      (endpoint.responseMode !== 'none' && endpoint.responseFields.some((field) => field.suggested === true)),
    );
    if (hasUnreviewedSuggestion) return false;
  }
  return true;
}

function inferReferenceRole(name: string): InterfaceSpecManualReferenceRole {
  const normalized = name.toLowerCase();
  if (/사전|용어|dictionary|glossary/.test(normalized)) return 'dictionary';
  if (/template|템플릿|양식/.test(normalized)) return 'output-template';
  if (/openapi|swagger|api[-_ ]?standard/.test(normalized) || /\.ya?ml$/.test(normalized)) return 'api-standard';
  if (/sample|example|샘플|예시|request|response/.test(normalized) || /\.json$/.test(normalized)) return 'sample';
  if (/requirement|specification|요구|기획|정의서|정책/.test(normalized) || /\.(pdf|docx|md|txt)$/.test(normalized)) return 'requirements';
  return 'other';
}

function nextId(prefix: string, ids: string[]): string {
  let index = ids.length + 1;
  while (ids.includes(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

export function InterfaceSpecManualInput({
  value,
  disabled,
  projectId,
  onChange,
}: {
  value: string;
  disabled: boolean;
  projectId?: string;
  onChange: (value: string) => void;
}) {
  const draft = useMemo(() => readDraft(value), [value]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  function commit(next: InterfaceSpecManualDraft) {
    onChange(JSON.stringify(next));
  }

  function patchRoot(patch: Partial<InterfaceSpecManualDraft>) {
    commit({ ...draft, ...patch });
  }

  function patchEndpoint(index: number, patch: Partial<InterfaceSpecManualEndpointDraft>) {
    const endpoints = draft.endpoints.map((endpoint, endpointIndex) =>
      endpointIndex === index ? { ...endpoint, ...patch } : endpoint,
    );
    commit({ ...draft, endpoints });
  }

  function selectAssistMode(mode: InterfaceSpecManualAssistMode) {
    if (draft.assistMode === mode) return;
    const endpoints = mode === 'manual'
      ? draft.endpoints.map((endpoint) => ({
          ...endpoint,
          requestMode: endpoint.requestMode === 'ai' ? 'manual' as const : endpoint.requestMode,
          responseMode: endpoint.responseMode === 'ai' ? 'manual' as const : endpoint.responseMode,
        }))
      : draft.endpoints;
    commit({
      ...draft,
      assistMode: mode,
      reviewStage: mode === 'ai' ? 'intake' : 'review',
      endpoints,
    });
  }

  async function uploadReferences(files: File[]) {
    if (!projectId || disabled || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      const result = await uploadProjectFiles(projectId, files, '_monofield/interface-spec-inputs');
      if (result.uploaded.length === 0) {
        throw new Error(result.error ?? result.failed[0]?.error ?? '참고자료를 업로드하지 못했습니다.');
      }
      const existingPaths = new Set(draft.referenceFiles.map((reference) => reference.path));
      const referenceIds = draft.referenceFiles.map((reference) => reference.id);
      const additions: InterfaceSpecManualReferenceFile[] = result.uploaded.flatMap((uploaded, index) => {
        if (!uploaded.path || existingPaths.has(uploaded.path)) return [];
        const name = uploaded.name || uploaded.path.split(/[\\/]/).pop() || `참고자료 ${index + 1}`;
        const id = nextId('reference', referenceIds);
        existingPaths.add(uploaded.path);
        referenceIds.push(id);
        return [{
          id,
          name,
          path: uploaded.path,
          role: inferReferenceRole(name),
        }];
      });
      commit({
        ...draft,
        assistMode: 'ai',
        reviewStage: 'intake',
        referenceFiles: [...draft.referenceFiles, ...additions],
      });
      if (result.failed.length > 0) {
        setUploadError(`${result.failed.length}개 파일은 업로드하지 못했습니다.`);
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : '참고자료를 업로드하지 못했습니다.');
    } finally {
      setUploading(false);
    }
  }

  function patchReference(index: number, patch: Partial<InterfaceSpecManualReferenceFile>) {
    patchRoot({
      assistMode: 'ai',
      reviewStage: 'intake',
      referenceFiles: draft.referenceFiles.map((reference, referenceIndex) =>
        referenceIndex === index ? { ...reference, ...patch } : reference,
      ),
    });
  }

  function removeReference(index: number) {
    patchRoot({
      reviewStage: draft.assistMode === 'ai' ? 'intake' : draft.reviewStage,
      referenceFiles: draft.referenceFiles.filter((_, referenceIndex) => referenceIndex !== index),
    });
  }

  function addEndpoint() {
    const id = nextId('endpoint', draft.endpoints.map((endpoint) => endpoint.id));
    commit({ ...draft, endpoints: [...draft.endpoints, emptyEndpoint(id)] });
  }

  function removeEndpoint(index: number) {
    if (draft.endpoints.length === 1) return;
    commit({ ...draft, endpoints: draft.endpoints.filter((_, endpointIndex) => endpointIndex !== index) });
  }

  const ready = isInterfaceSpecManualDraftReady(value);
  const previewEndpoint = draft.endpoints[0];
  const previewFields = [
    ...(previewEndpoint?.requestFields ?? []),
    ...(previewEndpoint?.responseFields ?? []),
  ].slice(0, 3);
  const suggestedCount = draft.endpoints.reduce(
    (count, endpoint) => count +
      (endpoint.requestMode === 'none' ? 0 : endpoint.requestFields.filter((field) => field.suggested === true).length) +
      (endpoint.responseMode === 'none' ? 0 : endpoint.responseFields.filter((field) => field.suggested === true).length),
    0,
  );

  return (
    <div className={styles.root} data-testid="interface-spec-manual-input">
      <section className={`${styles.section} ${styles.intakeSection}`}>
        <div className={styles.sectionHead}>
          <span className={styles.step}>1</span>
          <div><strong>자료와 작성 방식</strong><p>요구사항, 샘플, 용어사전, 템플릿을 한 번에 주면 AI가 출처를 구분해 초안을 만듭니다.</p></div>
        </div>
        <div className={styles.assistChoices} role="group" aria-label="필드 작성 방식">
          <button type="button" disabled={disabled} aria-pressed={draft.assistMode === 'ai'} className={draft.assistMode === 'ai' ? styles.assistChoiceActive : styles.assistChoice} onClick={() => selectAssistMode('ai')}>
            <strong>AI 초안</strong><span>자료와 업무 설명을 읽고 REQUEST·RESPONSE를 제안합니다.</span><em>권장</em>
          </button>
          <button type="button" disabled={disabled} aria-pressed={draft.assistMode === 'manual'} className={draft.assistMode === 'manual' ? styles.assistChoiceActive : styles.assistChoice} onClick={() => selectAssistMode('manual')}>
            <strong>직접 작성</strong><span>추론 없이 입력한 사실만 명세서에 반영합니다.</span>
          </button>
        </div>
        <label className={`${styles.control} ${styles.contextControl}`}>
          <span>업무 배경과 공통 규칙</span>
          <textarea aria-label="업무 배경과 공통 규칙" disabled={disabled} value={draft.businessContext} placeholder="예: 주문 생성 API이며, 모든 ID는 UUID를 사용하고 응답은 공통 resultCode/resultMsg/result 구조를 따릅니다." onChange={(event) => patchRoot({ businessContext: event.target.value, reviewStage: draft.assistMode === 'ai' ? 'intake' : draft.reviewStage })} />
        </label>
        <div className={styles.referenceArea}>
          <div className={styles.referenceHead}>
            <div><strong>참고자료</strong><span>여러 파일을 함께 올릴 수 있습니다. 파일별 역할은 업로드 후 바꿀 수 있습니다.</span></div>
            <span className={styles.referenceCount}>{draft.referenceFiles.length}개</span>
          </div>
          <label className={`${styles.referenceDrop} ${!projectId ? styles.referenceDropDisabled : ''}`}>
            <input
              aria-label="인터페이스 명세 참고자료 업로드"
              type="file"
              accept={REFERENCE_ACCEPT}
              multiple
              disabled={disabled || uploading || !projectId}
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = '';
                void uploadReferences(files);
              }}
            />
            <strong>{uploading ? '자료를 업로드하는 중…' : '파일 선택 또는 여기에 놓기'}</strong>
            <span>{projectId ? 'XLSX, JSON, YAML, PDF, DOCX, PPTX, 이미지 등 지원' : '프로젝트에서만 참고자료를 업로드할 수 있습니다.'}</span>
          </label>
          {draft.referenceFiles.length > 0 ? (
            <div className={styles.referenceList}>
              {draft.referenceFiles.map((reference, referenceIndex) => (
                <div className={styles.referenceItem} key={reference.id}>
                  <div className={styles.referenceName}><strong>{reference.name}</strong><span>현재 프로젝트 · AI 분석 대상</span></div>
                  <select aria-label={`${reference.name} 자료 역할`} disabled={disabled} value={reference.role} onChange={(event) => patchReference(referenceIndex, { role: event.target.value as InterfaceSpecManualReferenceRole })}>
                    {REFERENCE_ROLES.map((role) => <option value={role.value} key={role.value}>{role.label}</option>)}
                  </select>
                  <button type="button" aria-label={`${reference.name} 제외`} title="초안 자료에서 제외" disabled={disabled} onClick={() => removeReference(referenceIndex)}>×</button>
                </div>
              ))}
            </div>
          ) : null}
          {uploadError ? <div className={styles.uploadError} role="alert">{uploadError}</div> : null}
          <p className={styles.referenceNote}>첨부 파일은 이 프로젝트에 보관되며 명세 초안의 근거로만 사용됩니다. 출력 템플릿 파일은 열·용어·형식 참고용이고, 실제 XLSX 형식은 아래 지원 템플릿에서 확정합니다.</p>
        </div>
        {draft.assistMode === 'ai' ? (
          <div className={styles.aiStage}>
            <span>{draft.reviewStage === 'intake' ? '자료 접수 · AI 초안 대기' : `AI 초안 검토 · 미확정 ${suggestedCount}건`}</span>
            {draft.reviewStage === 'review' ? <button type="button" disabled={disabled} onClick={() => patchRoot({ reviewStage: 'intake' })}>자료로 다시 제안받기</button> : null}
          </div>
        ) : null}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.step}>2</span>
          <div><strong>문서 기본 정보</strong><p>문서명과 관리 정보는 표지와 파일명에 사용됩니다.</p></div>
        </div>
        <div className={styles.coreGrid}>
          <label className={styles.control}>
            <span>문서명 <b>*</b></span>
            <input aria-label="문서명" disabled={disabled} value={draft.documentName} placeholder="주문 API 인터페이스 명세서" onChange={(event) => patchRoot({ documentName: event.target.value })} />
          </label>
          <label className={styles.control}>
            <span>버전</span>
            <input aria-label="문서 버전" disabled={disabled} value={draft.version} onChange={(event) => patchRoot({ version: event.target.value })} />
          </label>
          <label className={styles.control}>
            <span>관리 부서</span>
            <input aria-label="관리 부서" disabled={disabled} value={draft.department} placeholder="선택 입력" onChange={(event) => patchRoot({ department: event.target.value })} />
          </label>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.step}>3</span>
          <div><strong>인터페이스와 필드</strong><p>Method·Path·업무 목적을 기준으로 AI가 제안하며, 확정 전에는 원본 명세에 반영하지 않습니다.</p></div>
        </div>
        <div className={styles.endpoints}>
          {draft.endpoints.map((endpoint, endpointIndex) => (
            <details className={styles.endpoint} open key={endpoint.id}>
              <summary>
                <span>{endpoint.interfaceName || `인터페이스 ${endpointIndex + 1}`}</span>
                <code>{[endpoint.method, endpoint.path].filter(Boolean).join(' ') || 'METHOD /path'}</code>
              </summary>
              <div className={styles.endpointBody}>
                <div className={styles.endpointGrid}>
                  <label className={styles.control}><span>인터페이스명 <b>*</b></span><input aria-label={`인터페이스 ${endpointIndex + 1} 이름`} disabled={disabled} value={endpoint.interfaceName} placeholder="주문 생성" onChange={(event) => patchEndpoint(endpointIndex, { interfaceName: event.target.value })} /></label>
                  <label className={styles.control}><span>인터페이스 ID</span><input aria-label={`인터페이스 ${endpointIndex + 1} ID`} disabled={disabled} value={endpoint.interfaceId} placeholder="자동 생성 또는 IF-ORD-001" onChange={(event) => patchEndpoint(endpointIndex, { interfaceId: event.target.value.toUpperCase() })} /></label>
                  <label className={styles.control}><span>Method <b>*</b></span><select aria-label={`인터페이스 ${endpointIndex + 1} Method`} disabled={disabled} value={endpoint.method} onChange={(event) => patchEndpoint(endpointIndex, { method: event.target.value })}><option value="">선택</option>{METHODS.map((method) => <option key={method} value={method}>{method}</option>)}</select></label>
                  <label className={`${styles.control} ${styles.pathControl}`}><span>Path <b>*</b></span><input aria-label={`인터페이스 ${endpointIndex + 1} Path`} disabled={disabled} value={endpoint.path} placeholder="/api/orders" onChange={(event) => patchEndpoint(endpointIndex, { path: event.target.value })} /></label>
                   <label className={styles.control}><span>인증</span><select aria-label={`인터페이스 ${endpointIndex + 1} 인증`} disabled={disabled} value={endpoint.auth} onChange={(event) => patchEndpoint(endpointIndex, { auth: event.target.value as InterfaceSpecManualEndpointDraft['auth'] })}><option value="undecided">미정 (TBD)</option><option value="none">없음</option><option value="bearer">Bearer</option><option value="api-key">API Key</option><option value="session-cookie">Session Cookie</option><option value="custom">기타</option></select></label>
                 </div>

                 <label className={`${styles.control} ${styles.purposeControl}`}><span>업무 목적·처리 규칙</span><textarea aria-label={`인터페이스 ${endpointIndex + 1} 업무 목적`} disabled={disabled} value={endpoint.businessPurpose} placeholder="예: 고객과 상품 목록을 받아 주문을 생성하고 생성된 주문 ID와 처리 상태를 반환합니다." onChange={(event) => patchEndpoint(endpointIndex, { businessPurpose: event.target.value })} /></label>

                <FieldGrid title="REQUEST" kind="requestFields" endpoint={endpoint} endpointIndex={endpointIndex} disabled={disabled} reviewStage={draft.reviewStage} onPatch={patchEndpoint} />
                <FieldGrid title="RESPONSE" kind="responseFields" endpoint={endpoint} endpointIndex={endpointIndex} disabled={disabled} reviewStage={draft.reviewStage} onPatch={patchEndpoint} />
                {draft.endpoints.length > 1 ? <button className={styles.removeButton} type="button" disabled={disabled} onClick={() => removeEndpoint(endpointIndex)}>이 인터페이스 삭제</button> : null}
              </div>
            </details>
          ))}
        </div>
        <button className={styles.addButton} type="button" disabled={disabled} onClick={addEndpoint}>+ 인터페이스 추가</button>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.step}>4</span>
          <div><strong>엑셀 템플릿</strong><p>미리보기와 실제 XLSX에 같은 템플릿이 적용됩니다.</p></div>
        </div>
        <div className={styles.templates}>
          {TEMPLATE_OPTIONS.map((template) => (
            <button
              key={template.id}
              type="button"
              disabled={disabled}
              aria-pressed={draft.templatePreset === template.id}
              className={`${styles.templateCard} ${styles[template.id]} ${draft.templatePreset === template.id ? styles.selected : ''}`}
              onClick={() => patchRoot({ templatePreset: template.id })}
            >
              <span className={styles.templateTitle}>{template.name}{template.recommended ? <em>권장 · 현재 기본</em> : null}</span>
              <span className={styles.templateDescription}>{template.description}</span>
              <span className={styles.sheetPreview} aria-hidden="true">
                <span className={styles.sheetTitle}>{previewEndpoint?.interfaceName || '인터페이스 명세서'}</span>
                <span className={styles.sheetMeta}>{previewEndpoint?.method || 'METHOD'} {previewEndpoint?.path || '/api/path'}</span>
                <span className={styles.sheetHeader}>영문명　한글명　타입　필수</span>
                {(previewFields.length > 0 ? previewFields : [{ id: 'sample', nameEn: 'sampleField', nameKo: '샘플 필드', dataType: 'String', minSize: '', maxSize: '', required: 'TBD' as const, note: '', evidence: '' }]).map((field) => <span className={styles.sheetRow} key={field.id}>{field.nameEn || 'field'}　{field.nameKo || '-'}　{field.dataType || 'TBD'}　{field.required}</span>)}
                {previewFields.length === 0 ? <small>샘플 데이터</small> : null}
              </span>
            </button>
          ))}
        </div>
      </section>

      <div className={`${styles.status} ${ready ? styles.ready : styles.incomplete}`}>
        {draft.assistMode === 'ai' && draft.reviewStage === 'intake'
          ? (ready ? '계속하면 첨부 자료와 업무 설명을 읽어 AI 초안을 만듭니다.' : '문서명과 각 인터페이스의 이름, Method, Path를 입력하세요.')
          : suggestedCount > 0
            ? `AI 제안 ${suggestedCount}건을 수정하거나 모두 채택한 뒤 계속하세요.`
            : ready
              ? '검토가 끝났습니다. 계속하면 같은 원본으로 미리보기와 XLSX를 생성합니다.'
              : '문서명과 각 인터페이스의 이름, Method, Path를 입력하세요. 추가한 필드에는 영문명이 필요합니다.'}
      </div>
    </div>
  );
}

function FieldGrid({
  title,
  kind,
  endpoint,
  endpointIndex,
  disabled,
  reviewStage,
  onPatch,
}: {
  title: string;
  kind: 'requestFields' | 'responseFields';
  endpoint: InterfaceSpecManualEndpointDraft;
  endpointIndex: number;
  disabled: boolean;
  reviewStage: InterfaceSpecManualDraft['reviewStage'];
  onPatch: (index: number, patch: Partial<InterfaceSpecManualEndpointDraft>) => void;
}) {
  const fields = endpoint[kind];
  const modeKey = kind === 'requestFields' ? 'requestMode' : 'responseMode';
  const mode = endpoint[modeKey];
  const suggestedCount = fields.filter((field) => field.suggested === true).length;

  function patchField(index: number, patch: Partial<InterfaceSpecManualFieldDraft>) {
    onPatch(endpointIndex, { [kind]: fields.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...patch } : field) });
  }

  function patchFieldAsUser(index: number, patch: Partial<InterfaceSpecManualFieldDraft>) {
    patchField(index, { ...patch, suggested: false, evidence: '' });
  }

  function changeMode(nextMode: InterfaceSpecManualFieldMode) {
    onPatch(endpointIndex, { [modeKey]: nextMode } as Partial<InterfaceSpecManualEndpointDraft>);
  }

  function addField() {
    const prefix = `${endpoint.id}-${kind === 'requestFields' ? 'request' : 'response'}`;
    onPatch(endpointIndex, { [kind]: [...fields, emptyField(nextId(prefix, fields.map((field) => field.id)))] });
  }

  function removeField(index: number) {
    onPatch(endpointIndex, { [kind]: fields.filter((_, fieldIndex) => fieldIndex !== index) });
  }

  function acceptAllSuggestions() {
    onPatch(endpointIndex, {
      [kind]: fields.map((field) => field.suggested ? { ...field, suggested: false } : field),
    });
  }

  return (
    <div className={styles.fieldBlock}>
      <div className={styles.fieldBlockHead}>
        <div className={styles.fieldTitle}><strong>{title}</strong><span>크기는 문자열 길이·배열 항목 수 기준이며, 모르면 비워 둘 수 있습니다.</span></div>
        <div className={styles.fieldActions}>
          <div className={styles.fieldModes} role="group" aria-label={`${title} 작성 방식`}>
            <button type="button" disabled={disabled} aria-pressed={mode === 'ai'} className={mode === 'ai' ? styles.fieldModeActive : undefined} onClick={() => changeMode('ai')}>AI 제안</button>
            <button type="button" disabled={disabled} aria-pressed={mode === 'manual'} className={mode === 'manual' ? styles.fieldModeActive : undefined} onClick={() => changeMode('manual')}>직접 입력</button>
            <button type="button" disabled={disabled} aria-pressed={mode === 'none'} className={mode === 'none' ? styles.fieldModeActive : undefined} onClick={() => changeMode('none')}>필드 없음</button>
          </div>
          {suggestedCount > 0 ? <button className={styles.acceptButton} type="button" disabled={disabled} onClick={acceptAllSuggestions}>제안 {suggestedCount}건 모두 채택</button> : null}
          {mode !== 'none' ? <button type="button" disabled={disabled} onClick={addField}>+ 필드 추가</button> : null}
        </div>
      </div>
      {mode === 'none' ? <div className={`${styles.empty} ${styles.noneConfirmed}`}>이 영역은 필드 없음으로 확정됩니다.</div> : fields.length === 0 ? (
        <div className={styles.empty}>{mode === 'ai' ? (reviewStage === 'intake' ? '계속하면 AI가 자료와 업무 설명을 바탕으로 필드를 제안합니다.' : 'AI가 제안할 필드를 찾지 못했습니다. 직접 추가하거나 필드 없음으로 확정하세요.') : '아직 필드가 없습니다.'}</div>
      ) : (
        <div className={styles.fieldTable} role="table" aria-label={title}>
          <div className={styles.fieldHeader} role="row"><span>영문명 *</span><span>한글명</span><span>타입</span><span>최소 크기</span><span>최대 크기</span><span>필수</span><span>비고</span><span /></div>
          {fields.map((field, fieldIndex) => (
            <div className={`${styles.fieldRow} ${field.suggested ? styles.suggested : ''}`} role="row" key={field.id}>
              <input aria-label={`${title} ${fieldIndex + 1} 영문명`} disabled={disabled} value={field.nameEn} placeholder="customerId" onChange={(event) => patchFieldAsUser(fieldIndex, { nameEn: event.target.value })} />
              <input aria-label={`${title} ${fieldIndex + 1} 한글명`} disabled={disabled} value={field.nameKo} placeholder="고객 ID" onChange={(event) => patchFieldAsUser(fieldIndex, { nameKo: event.target.value })} />
              <input aria-label={`${title} ${fieldIndex + 1} 타입`} disabled={disabled} value={field.dataType} placeholder="TBD" onChange={(event) => patchFieldAsUser(fieldIndex, { dataType: event.target.value })} />
              <input aria-label={`${title} ${fieldIndex + 1} 최소 크기`} disabled={disabled} value={field.minSize} placeholder="선택" onChange={(event) => patchFieldAsUser(fieldIndex, { minSize: event.target.value })} />
              <input aria-label={`${title} ${fieldIndex + 1} 최대 크기`} disabled={disabled} value={field.maxSize} placeholder="선택" onChange={(event) => patchFieldAsUser(fieldIndex, { maxSize: event.target.value })} />
              <select aria-label={`${title} ${fieldIndex + 1} 필수`} disabled={disabled} value={field.required} onChange={(event) => patchFieldAsUser(fieldIndex, { required: event.target.value as InterfaceSpecManualFieldDraft['required'] })}><option value="TBD">TBD</option><option value="Y">Y</option><option value="N">N</option></select>
              <input aria-label={`${title} ${fieldIndex + 1} 비고`} disabled={disabled} value={field.note} onChange={(event) => patchFieldAsUser(fieldIndex, { note: event.target.value })} />
              <button aria-label={`${title} ${fieldIndex + 1} 삭제`} title="필드 삭제" type="button" disabled={disabled} onClick={() => removeField(fieldIndex)}>×</button>
              {field.suggested ? <span className={styles.suggestedBadge}>AI 제안 · 확인 필요{field.evidence ? ` · 근거: ${field.evidence}` : ''}</span> : field.evidence ? <span className={styles.evidenceBadge}>근거: {field.evidence}</span> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
