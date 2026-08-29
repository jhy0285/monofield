/**
 * Conservative routing helpers for interface-spec requests.
 *
 * These guard workflow ordering; they do not attempt to understand the
 * user's entire request. Explanatory questions stay conversational, while
 * explicit collection requests may enter the interface-spec collector.
 */
const HOW_TO_PATTERNS = [
  /만드는\s*(?:법|방법)/i,
  /작성하는\s*(?:법|방법)/i,
  /생성하는\s*(?:법|방법)/i,
  /어떻게(?:\s|$)/i,
  /무엇(?:인가|이야|인지)/i,
  /뭐(?:야|예요|에요)/i,
  /의미|차이/i,
  /설명(?:해|을|이)/i,
  /알려\s*줘/i,
  /사용법|가이드|튜토리얼/i,
  /how\s+to|what\s+is|explain|meaning|difference|guide|tutorial/i,
];

const GENERATION_PATTERNS = [
  /만들(?:어|고|자|줘)/i,
  /생성(?:해|하|된|해줘)/i,
  /작성(?:해|하|된|해줘)/i,
  /추가(?:해|하|할|해줘)/i,
  /설계(?:해|하|할|해줘)/i,
  /정리(?:해|하|된|해줘)/i,
  /수집(?:해|하|된|해줘)/i,
  /스캔(?:해|하|된|해줘)/i,
  /분석(?:해서|해|하|된|해줘)/i,
  /추출(?:해|하|된|해줘)/i,
  /내보내|엑셀로|워크북/i,
  /generate|create|build|scan|collect|produce|export|render|workbook|xlsx/i,
];

const ARTIFACT_CHANGE_PATTERNS = [
  /수정(?:해|하|할|해줘)/i,
  /변경(?:해|하|할|해줘)/i,
  /검증(?:해|하|할|해줘)/i,
  /확인(?:해|하|할|해줘)/i,
  /미리\s*보기|프리뷰/i,
  /저장(?:해|하|할|해줘)/i,
  /edit|modify|update|revise|validate|verify|preview|save/i,
];

const SCREEN_SPEC_PATTERNS = [
  /화면\s*명세/i,
  /screen\s*spec/i,
  /화면\s*설명서/i,
];

const STRUCTURED_SPEC_FORM_ANSWER = /\[form answers\s*[—-]\s*(?:interface|screen)-spec-[^\]]+\]/i;

const INTERFACE_SPEC_PATTERNS = [
  /인터페이스\s*명세/i,
  /interface\s*spec/i,
  /api\s*명세/i,
  /api\b/i,
  /endpoint|route|dto|schema|openapi/i,
  /명세서/i,
];

const MANUAL_SOURCE_PATTERNS = [
  /코드\s*베이스\s*(?:가\s*)?(?:없이|없는)/i,
  /(?:소스|코드)\s*(?:가\s*)?(?:없이|없는)/i,
  /신규\s*(?:인터페이스|api|명세)/i,
  /(?:처음부터|새로)\s*(?:설계|작성|생성|만들)/i,
  /요구\s*사항\s*(?:만으로|기반)/i,
  /수동\s*(?:작성|입력|설계)/i,
  /without\s+(?:a\s+)?codebase|no[-\s]?code(?:base)?|from\s+scratch|greenfield|manual(?:ly)?/i,
];

const CODEBASE_SOURCE_PATTERNS = [
  /코드\s*베이스(?:를|에서|로|의|\s|$)/i,
  /(?:소스|코드)(?:를|에서)?\s*(?:읽|분석|검사|스캔|추출)/i,
  /(?:작업|소스)\s*폴더(?:를|에서|로|\s)/i,
  /(?:저장소|리포지토리|레포)(?:를|에서|로|\s)/i,
  /codebase|source\s*(?:folder|tree)|repository|\brepo\b/i,
];

export type InterfaceSpecSourceIntent = 'manual' | 'codebase' | 'unspecified';

/**
 * Classify the requested source without guessing. Manual intent wins when a
 * sentence contains both kinds of words (for example "코드베이스 없이 신규
 * API"), so an incidental codebase mention never triggers the folder gate.
 */
export function classifyInterfaceSpecSourceIntent(
  input: string | null | undefined,
): InterfaceSpecSourceIntent {
  const text = typeof input === 'string' ? input.trim() : '';
  if (!text) return 'unspecified';
  if (MANUAL_SOURCE_PATTERNS.some((pattern) => pattern.test(text))) return 'manual';
  if (CODEBASE_SOURCE_PATTERNS.some((pattern) => pattern.test(text))) return 'codebase';
  return 'unspecified';
}

export function isDocumentHowToRequest(input: string | null | undefined): boolean {
  const text = typeof input === 'string' ? input.trim() : '';
  return text.length > 0 && HOW_TO_PATTERNS.some((pattern) => pattern.test(text));
}

export function isInterfaceSpecGenerationRequest(input: string | null | undefined): boolean {
  const text = typeof input === 'string' ? input.trim() : '';
  if (!text || !INTERFACE_SPEC_PATTERNS.some((pattern) => pattern.test(text))) return false;
  if (/화면\s*명세|screen\s*spec/i.test(text)) return false;
  if (isDocumentHowToRequest(text)) return false;
  return GENERATION_PATTERNS.some((pattern) => pattern.test(text));
}

export function isManualInterfaceSpecGenerationRequest(
  input: string | null | undefined,
): boolean {
  return (
    isInterfaceSpecGenerationRequest(input) &&
    classifyInterfaceSpecSourceIntent(input) === 'manual'
  );
}

export type StructuredSpecificationKind = 'interface-spec' | 'screen-spec';

/**
 * Return true only when this turn needs the heavyweight collector / renderer
 * instructions for a structured specification.  The result is intentionally
 * a two-value routing profile rather than a hash of the raw user text: all
 * guidance turns share one stable system prompt fingerprint and all artifact
 * turns share the other, preserving provider prompt-cache reuse.
 *
 * Form answers count as artifact work because the UI wraps deterministic
 * collector submissions with the form id.  Explanations and how-to questions
 * never do, even when they contain words such as "interface spec".
 */
export function isStructuredSpecificationArtifactRequest(
  input: string | null | undefined,
  kind: StructuredSpecificationKind | null | undefined,
): boolean {
  const text = typeof input === 'string' ? input.trim() : '';
  if (!text || (kind !== 'interface-spec' && kind !== 'screen-spec')) return false;
  if (STRUCTURED_SPEC_FORM_ANSWER.test(text)) return true;
  if (isDocumentHowToRequest(text)) return false;

  // The project kind already supplies the artifact noun. Requiring the user
  // to repeat "interface spec" / "screen spec" on every follow-up would
  // incorrectly send terse edits such as "현재 초안 수정해줘" through the
  // guidance profile. Keep only the cross-kind guard that prevents a screen
  // specification request inside an interface project from starting the
  // interface collector.
  if (kind === 'interface-spec' && SCREEN_SPEC_PATTERNS.some((pattern) => pattern.test(text))) {
    return false;
  }
  return [...GENERATION_PATTERNS, ...ARTIFACT_CHANGE_PATTERNS]
    .some((pattern) => pattern.test(text));
}
