import type { InterfaceSpecChangeCode, InterfaceSpecChangeLevel } from './interface-spec-compatibility.js';

/**
 * Names of the compatibility changes and levels in Korean and English, for surfaces that have no i18n runtime: the
 * `monofield docs check` report, pull-request comments and logs. The web app keeps its own copies in all locales;
 * `apps/web/tests/i18n` checks that its Korean and English match these.
 */
export type InterfaceSpecReportLanguage = 'ko' | 'en';

export const INTERFACE_SPEC_CHANGE_LABELS: Record<InterfaceSpecChangeCode, Record<InterfaceSpecReportLanguage, string>> = {
  'endpoint-removed': { ko: "인터페이스 삭제", en: "Interface removed" },
  'endpoint-added': { ko: "인터페이스 추가", en: "Interface added" },
  'endpoint-methods-narrowed': { ko: "허용 HTTP 메서드 축소", en: "Fewer HTTP methods accepted" },
  'endpoint-methods-widened': { ko: "허용 HTTP 메서드 확대", en: "More HTTP methods accepted" },
  'auth-required-added': { ko: "인증 필요로 변경", en: "Now requires authentication" },
  'auth-required-removed': { ko: "인증 불필요로 변경", en: "No longer requires authentication" },
  'request-field-added-required': { ko: "필수 요청 필드 추가", en: "Required request field added" },
  'request-field-added-unresolved': { ko: "요청 필드 추가 (필수 여부 미정)", en: "Request field added (required: TBD)" },
  'request-field-added-optional': { ko: "선택 요청 필드 추가", en: "Optional request field added" },
  'request-field-removed': { ko: "요청 필드 삭제", en: "Request field removed" },
  'request-field-became-required': { ko: "요청 필드가 필수로 변경", en: "Request field became required" },
  'request-field-became-optional': { ko: "요청 필드가 선택으로 변경", en: "Request field became optional" },
  'request-field-max-size-reduced': { ko: "요청 필드 최대 길이 축소", en: "Request field max size reduced" },
  'response-field-removed': { ko: "응답 필드 삭제", en: "Response field removed" },
  'response-field-added': { ko: "응답 필드 추가", en: "Response field added" },
  'response-field-became-optional': { ko: "응답 필드가 선택으로 변경", en: "Response field may now be absent" },
  'field-type-changed': { ko: "필드 타입 변경", en: "Field type changed" },
  'auth-authorities-narrowed': { ko: "호출할 수 있는 권한이 좁아짐", en: "Fewer callers are allowed" },
  'auth-authorities-widened': { ko: "호출할 수 있는 권한이 넓어짐", en: "More callers are allowed" },
  'auth-rule-changed': { ko: "접근 규칙 변경", en: "Access rule changed" },
  'request-enum-value-added': { ko: "요청 허용값 추가", en: "Request accepts a new value" },
  'request-enum-value-removed': { ko: "요청 허용값 삭제", en: "Request value no longer accepted" },
  'response-enum-value-added': { ko: "응답에 새 값이 올 수 있음", en: "Response may return a new value" },
  'response-enum-value-removed': { ko: "응답 값 삭제", en: "Response no longer returns a value" },
  'request-default-changed': { ko: "요청 기본값 변경", en: "Request default changed" },
};

export const INTERFACE_SPEC_LEVEL_LABELS: Record<InterfaceSpecChangeLevel | 'none', Record<InterfaceSpecReportLanguage, string>> = {
  breaking: { ko: "호환성 깨짐", en: "Breaking" },
  warning: { ko: "확인 필요", en: "Needs review" },
  info: { ko: "추가 변경", en: "Additive" },
  none: { ko: "호출자에게 보이는 변경 없음", en: "No caller-visible change" },
};
