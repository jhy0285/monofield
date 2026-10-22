const DISMISSED = 'monofield:ontology-tutorial-dismissed:v1';
const SEEN = 'monofield:ontology-tutorial-seen:v1';

export function ontologyTutorialDismissed(): boolean {
  try { return window.localStorage.getItem(DISMISSED) === 'true'; }
  catch { return false; }
}

export function shouldShowOntologyTutorial(): boolean {
  try { return !ontologyTutorialDismissed() && window.sessionStorage.getItem(SEEN) !== 'true'; }
  catch { return !ontologyTutorialDismissed(); }
}

export function dismissOntologyTutorial(permanently: boolean): void {
  try {
    if (permanently) window.localStorage.setItem(DISMISSED, 'true');
    else window.localStorage.removeItem(DISMISSED);
  } catch { /* Storage restrictions must not block closing the guide. */ }
  try { window.sessionStorage.setItem(SEEN, 'true'); } catch { /* Session-only fallback is held by the panel. */ }
}
