import type { Locale } from '../i18n/types';

// Match the development workspace's Korean/English copy; other locales fall
// back to English rather than suggesting document-generation tasks.
export function developmentWorkflowCopy(locale: Locale) {
  return locale === 'ko' ? {
    files: '프로젝트 파일',
    starters: [
      { icon: '⌘', title: '코드 구조 파악', tag: '분석', prompt: '연결된 프로젝트의 진입점, 주요 모듈, 실행 및 테스트 명령을 확인해 설명해 주세요. 아직 파일은 수정하지 마세요.' },
      { icon: '✓', title: '테스트 실행과 수정', tag: '검증', prompt: '프로젝트의 테스트 설정을 확인하고 관련 테스트를 실행해 주세요. 실패하면 원인을 재현하고 필요한 수정 후 같은 테스트로 검증해 주세요.' },
      { icon: '↔', title: '변경사항 검토', tag: '리뷰', prompt: '현재 Git 변경사항을 검토하고 오류 가능성과 빠진 검증을 파일 위치와 함께 알려 주세요. 파일 수정이나 커밋 전에 검토 결과부터 보여 주세요.' },
    ],
  } : {
    files: 'Project files',
    starters: [
      { icon: '⌘', title: 'Understand the code', tag: 'Explore', prompt: 'Inspect the connected project and explain its entry points, main modules, and commands for running and testing it. Do not edit files yet.' },
      { icon: '✓', title: 'Run and fix tests', tag: 'Verify', prompt: 'Inspect the test configuration and run the relevant tests. Reproduce any failure, fix its cause, and rerun the same tests to verify the change.' },
      { icon: '↔', title: 'Review changes', tag: 'Review', prompt: 'Review the current Git changes for bugs and missing validation, citing file locations. Show the findings before editing files or making commits.' },
    ],
  };
}
