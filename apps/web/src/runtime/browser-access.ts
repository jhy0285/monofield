export type BrowserAccessMode = 'view' | 'inspect' | 'automate';

export interface BrowserAccessCopy {
  access: string;
  choose: string;
  mode: Record<BrowserAccessMode, string>;
  description: Record<BrowserAccessMode, string>;
  availability: {
    approved: string;
    available: string;
    notConnected: string;
    desktopOnly: string;
  };
  activeUntil: (origin: string) => string;
  approvalExpiry: string;
  blockedUntilConnected: string;
  lastEvent: (action: string | null, message: string | null) => string;
  pointer: {
    active: string;
    ready: string;
    status: (action: string | null) => string;
  };
  stop: string;
  safety: {
    automate: string;
    inspect: string;
  };
  status: {
    originChanged: string;
    openPageToApprove: string;
    approvedUntilStopped: string;
    unavailable: string;
    inspectUnavailable: string;
    approvalRequired: string;
    requestAdded: string;
    chooseInspect: string;
    collectingEvidence: string;
    evidenceAdded: string;
    inspectEnabled: string;
    viewEnabled: string;
    stopped: string;
  };
  dialog: {
    kicker: string;
    title: string;
    body: (origin: string) => string;
    sensitiveFields: string;
    crossOrigin: string;
    systemApproval: string;
    stopAnyTime: string;
    cancel: string;
    waitingApproval: string;
    continueApproval: string;
  };
}

export interface BrowserAccessEnvironment {
  automationBackendConnected?: boolean;
  desktopWebview: boolean;
}

export interface BrowserAccessPolicy {
  available: boolean;
  canAutomate: boolean;
  canCollectEvidence: boolean;
  canNavigate: boolean;
  mode: BrowserAccessMode;
  reason?: string;
  requiresConfirmation: boolean;
}

export const BROWSER_ACCESS_LABELS: Record<BrowserAccessMode, string> = {
  view: 'View',
  inspect: 'Inspect',
  automate: 'Automate',
};

const BROWSER_ACCESS_COPY: BrowserAccessCopy = {
  access: 'Browser access',
  choose: 'Choose what MonoField may do with the current page.',
  mode: BROWSER_ACCESS_LABELS,
  description: {
    view: 'Browse, capture, and annotate manually.',
    inspect: 'Collect bounded DOM, asset, style, and accessibility evidence. No clicks, typing, storage, or form values.',
    automate: 'DOM-guided native pointer, typing, and navigation with a bounded fallback. Requires explicit approval.',
  },
  availability: {
    approved: 'Approved',
    available: 'Available',
    notConnected: 'Not connected',
    desktopOnly: 'Desktop only',
  },
  activeUntil: (origin) => `Active for ${origin} until you stop it, close the tab, leave the origin, or quit MonoField.`,
  approvalExpiry: 'Automation starts only after explicit approval and remains active until you stop it, close the tab, leave the origin, or quit MonoField.',
  blockedUntilConnected: 'Automation stays blocked until the desktop Browser Service is connected.',
  lastEvent: (action, message) => `Last event: ${action ?? ''} — ${message ?? ''}`,
  pointer: {
    active: 'Agent pointer',
    ready: 'DOM-guided pointer ready',
    status: (action) => action ? `${action} · native pointer` : 'DOM-guided pointer ready',
  },
  stop: 'Stop',
  safety: {
    automate: 'Approved Automate — current tab/origin only; sensitive fields and arbitrary JavaScript remain blocked.',
    inspect: 'Read-only Inspect — no clicks, typing, storage, form values, or credentials.',
  },
  status: {
    originChanged: 'Automation stopped because the browser origin changed.',
    openPageToApprove: 'Open an attached http(s) page before approving automation.',
    approvedUntilStopped: 'Automation approved for this tab and origin until you stop it or the session is revoked.',
    unavailable: 'This browser access mode is unavailable.',
    inspectUnavailable: 'Read-only inspection is unavailable.',
    approvalRequired: 'Approve an active browser automation session first.',
    requestAdded: 'Automation request added to the composer. Review it, then send.',
    chooseInspect: 'Choose Inspect before collecting page evidence.',
    collectingEvidence: 'Collecting read-only browser evidence…',
    evidenceAdded: 'Read-only browser evidence added to composer',
    inspectEnabled: 'Read-only inspection enabled. Clicks, typing, storage, and credentials remain blocked.',
    viewEnabled: 'View mode enabled. Browsing and manual annotations remain available.',
    stopped: 'Automation stopped.',
  },
  dialog: {
    kicker: 'Explicit browser permission',
    title: 'Allow agent automation for this page?',
    body: (origin) => `Until you stop it or the session is revoked, MonoField may read a bounded page snapshot and use a visible DOM-guided pointer to navigate within ${origin}, click controls, type into non-sensitive fields, and scroll this browser tab.`,
    sensitiveFields: 'Password, one-time-code, token, and payment-card fields are blocked.',
    crossOrigin: 'Cross-origin navigation and arbitrary JavaScript are blocked.',
    systemApproval: 'A system confirmation appears before the desktop service issues permission.',
    stopAnyTime: 'You can stop the session at any time from Browser access.',
    cancel: 'Cancel',
    waitingApproval: 'Waiting for system approval…',
    continueApproval: 'Continue to system approval',
  },
};

const BROWSER_ACCESS_COPY_KO: BrowserAccessCopy = {
  access: '브라우저 접근',
  choose: '현재 페이지에서 MonoField가 할 수 있는 작업을 선택하세요.',
  mode: { view: '보기', inspect: '검사', automate: '자동화' },
  description: {
    view: '페이지를 탐색하고 캡처하며 화면에 주석을 직접 추가합니다.',
    inspect: '제한된 DOM·에셋·스타일·접근성 근거를 수집합니다. 클릭, 입력, 저장소, 폼 값은 읽지 않습니다.',
    automate: 'DOM으로 대상을 찾고 실제 포인터로 클릭·입력·탐색하며, 필요한 경우 제한된 DOM 방식으로 전환합니다. 명시적 승인이 필요합니다.',
  },
  availability: {
    approved: '승인됨',
    available: '사용 가능',
    notConnected: '연결 안 됨',
    desktopOnly: '데스크톱 전용',
  },
  activeUntil: (origin) => `${origin}에서 중지하거나 세션이 취소될 때까지 활성화되어 있습니다.`,
  approvalExpiry: '명시적 승인 후에 시작되며 중지하거나 탭·출처·앱이 종료될 때까지 유지됩니다.',
  blockedUntilConnected: '데스크톱 브라우저 서비스가 연결될 때까지 자동화가 차단됩니다.',
  lastEvent: (action, message) => '마지막 이벤트: ' + (action ?? '') + ' — ' + (message ?? ''),
  pointer: {
    active: '에이전트 포인터',
    ready: 'DOM 기반 포인터 준비됨',
    status: (action) => action ? `${action} · 실제 포인터` : 'DOM 기반 포인터 준비됨',
  },
  stop: '중지',
  safety: {
    automate: '승인된 자동화 — 현재 탭/출처만 사용하며 민감한 필드와 임의 JavaScript는 차단됩니다.',
    inspect: '읽기 전용 검사 — 클릭, 입력, 저장소, 폼 값, 자격 증명을 읽지 않습니다.',
  },
  status: {
    originChanged: '브라우저 출처가 변경되어 자동화를 중지했습니다.',
    openPageToApprove: '자동화를 승인하기 전에 연결된 http(s) 페이지를 여세요.',
    approvedUntilStopped: '이 탭과 출처에 자동화를 승인했습니다. 중지하거나 세션이 취소될 때까지 유지됩니다.',
    unavailable: '이 브라우저 접근 모드는 사용할 수 없습니다.',
    inspectUnavailable: '읽기 전용 검사를 사용할 수 없습니다.',
    approvalRequired: '먼저 활성 브라우저 자동화 세션을 승인하세요.',
    requestAdded: '자동화 요청을 작성기에 추가했습니다. 검토한 뒤 전송하세요.',
    chooseInspect: '페이지 근거를 수집하려면 먼저 검사를 선택하세요.',
    collectingEvidence: '읽기 전용 브라우저 근거 수집 중…',
    evidenceAdded: '읽기 전용 브라우저 근거를 작성기에 추가했습니다.',
    inspectEnabled: '읽기 전용 검사를 사용합니다. 클릭·입력·저장소·자격 증명은 차단됩니다.',
    viewEnabled: '보기 모드를 사용합니다. 탐색과 수동 화면 주석을 계속 사용할 수 있습니다.',
    stopped: '자동화를 중지했습니다.',
  },
  dialog: {
    kicker: '브라우저 권한 확인',
    title: '이 페이지에서 에이전트 자동화를 허용할까요?',
    body: (origin) => `중지하거나 세션이 취소될 때까지 MonoField가 제한된 페이지 스냅샷을 읽고, 화면에 보이는 DOM 기반 포인터로 ${origin} 안에서 탐색·클릭·비민감 입력·스크롤을 수행할 수 있습니다.`,
    sensitiveFields: '비밀번호·일회용 코드·토큰·결제 카드 입력은 차단됩니다.',
    crossOrigin: '출처가 다른 탐색과 임의 JavaScript는 차단됩니다.',
    systemApproval: '데스크톱 서비스가 권한을 발급하기 전에 시스템 확인 창이 표시됩니다.',
    stopAnyTime: '브라우저 접근 메뉴에서 언제든지 세션을 중지할 수 있습니다.',
    cancel: '취소',
    waitingApproval: '시스템 승인 대기 중…',
    continueApproval: '시스템 승인 계속',
  },
};

/** Localized browser access copy. Unsupported locales intentionally fall back
 * to English until their full product dictionaries are translated. */
export function browserAccessCopy(locale?: string): BrowserAccessCopy {
  return locale?.toLowerCase() === 'ko' ? BROWSER_ACCESS_COPY_KO : BROWSER_ACCESS_COPY;
}

/**
 * Central policy boundary for the embedded browser.
 *
 * Manual browsing is always available. Reading page structure is deliberately
 * limited to the desktop webview bridge, while click/type/navigation automation
 * remains unavailable until a separately permissioned backend is connected.
 */
export function resolveBrowserAccessPolicy(
  mode: BrowserAccessMode,
  environment: BrowserAccessEnvironment,
): BrowserAccessPolicy {
  if (mode === 'view') {
    return {
      available: true,
      canAutomate: false,
      canCollectEvidence: false,
      canNavigate: true,
      mode,
      requiresConfirmation: false,
    };
  }

  if (mode === 'inspect') {
    const available = environment.desktopWebview;
    return {
      available,
      canAutomate: false,
      canCollectEvidence: available,
      canNavigate: true,
      mode,
      reason: available
        ? undefined
        : 'Read-only inspection is available in the MonoField desktop app.',
      requiresConfirmation: false,
    };
  }

  const available = environment.desktopWebview && environment.automationBackendConnected === true;
  return {
    available,
    canAutomate: available,
    canCollectEvidence: false,
    canNavigate: true,
    mode,
    reason: available
      ? undefined
      : environment.desktopWebview
        ? 'Automation service is not connected. Click, type, and agent navigation remain blocked.'
        : 'Browser automation requires the MonoField desktop app and an approved automation service.',
    requiresConfirmation: true,
  };
}
