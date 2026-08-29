import { describe, expect, it } from 'vitest';

import {
  classifyInterfaceSpecSourceIntent,
  isDocumentHowToRequest,
  isInterfaceSpecGenerationRequest,
  isManualInterfaceSpecGenerationRequest,
  isStructuredSpecificationArtifactRequest,
} from '../src/api/interface-spec-intent.js';

describe('interface-spec intent routing', () => {
  it('keeps how-to questions out of the collector', () => {
    expect(isDocumentHowToRequest('명세서 만드는법')).toBe(true);
    expect(isInterfaceSpecGenerationRequest('명세서 만드는법')).toBe(false);
    expect(isInterfaceSpecGenerationRequest('인터페이스 명세서 만드는 방법 알려줘')).toBe(false);
  });

  it('recognizes explicit interface-spec generation requests', () => {
    expect(
      isInterfaceSpecGenerationRequest('이 코드베이스의 API를 분석해서 인터페이스 명세서 엑셀을 만들어줘'),
    ).toBe(true);
    expect(isInterfaceSpecGenerationRequest('Generate an interface spec workbook from this API')).toBe(true);
  });

  it('does not route an unrelated document request to interface-spec', () => {
    expect(isInterfaceSpecGenerationRequest('화면명세서 PPT를 만들어줘')).toBe(false);
    expect(isInterfaceSpecGenerationRequest('보고서 문서를 작성해줘')).toBe(false);
  });

  it('separates manual, codebase, and unspecified generation sources', () => {
    const manual = '코드베이스 없이 주문 생성 인터페이스 명세서를 만들어줘. POST /api/orders';
    expect(classifyInterfaceSpecSourceIntent(manual)).toBe('manual');
    expect(isManualInterfaceSpecGenerationRequest(manual)).toBe(true);
    expect(isManualInterfaceSpecGenerationRequest('신규 인터페이스 명세서를 추가해줘')).toBe(true);
    expect(classifyInterfaceSpecSourceIntent('이 소스를 읽어서 API 명세서를 만들어줘')).toBe('codebase');
    expect(classifyInterfaceSpecSourceIntent('주문 API 명세서를 만들어줘')).toBe('unspecified');
  });

  it('lets explicit no-code wording win over incidental codebase words', () => {
    expect(
      classifyInterfaceSpecSourceIntent('기존 코드베이스 없이 신규 API 명세서를 만들어줘'),
    ).toBe('manual');
  });

  it('routes only explicit structured-spec work to the heavyweight prompt profile', () => {
    expect(
      isStructuredSpecificationArtifactRequest('인터페이스 명세서가 뭐야?', 'interface-spec'),
    ).toBe(false);
    expect(
      isStructuredSpecificationArtifactRequest('화면 명세서 작성 방법을 설명해줘', 'screen-spec'),
    ).toBe(false);
    expect(
      isStructuredSpecificationArtifactRequest('주문 API 인터페이스 명세서를 만들어줘', 'interface-spec'),
    ).toBe(true);
    expect(
      isStructuredSpecificationArtifactRequest('이 화면 명세서를 검증해줘', 'screen-spec'),
    ).toBe(true);
    expect(
      isStructuredSpecificationArtifactRequest('현재 초안을 수정해줘', 'screen-spec'),
    ).toBe(true);
    expect(
      isStructuredSpecificationArtifactRequest('결과 미리 보기', 'interface-spec'),
    ).toBe(true);
    expect(
      isStructuredSpecificationArtifactRequest('일반적인 작성 원칙을 알려줘', 'screen-spec'),
    ).toBe(false);
    expect(
      isStructuredSpecificationArtifactRequest(
        '[form answers — interface-spec-options]\n{"scope":"all"}',
        'interface-spec',
      ),
    ).toBe(true);
  });
});
