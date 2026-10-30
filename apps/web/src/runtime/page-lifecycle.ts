// Whether the document is being torn down (a reload, a navigation, closing the
// tab). The browser cuts in-flight fetches when that happens, so a run's event
// stream then ends with a network error even though the run itself carries on
// in the daemon. Callers use this to tell that apart from a real failure and
// leave the run recoverable, so the next page load can reattach to it.
//
// The fetches are cut before `pagehide` fires, so `beforeunload` is the first
// signal. It can be cancelled by the user staying on the page, which fires
// nothing else, so that flag expires on its own. `pagehide` is final until
// `pageshow`, which clears it for a page restored from the back-forward cache.

const BEFORE_UNLOAD_GRACE_MS = 3000;

let hiding = false;
let beforeUnloadTimer: ReturnType<typeof setTimeout> | null = null;

function clearBeforeUnloadTimer(): void {
  if (beforeUnloadTimer === null) return;
  clearTimeout(beforeUnloadTimer);
  beforeUnloadTimer = null;
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    hiding = true;
    clearBeforeUnloadTimer();
    beforeUnloadTimer = setTimeout(() => {
      beforeUnloadTimer = null;
      hiding = false;
    }, BEFORE_UNLOAD_GRACE_MS);
  });
  window.addEventListener('pagehide', () => {
    clearBeforeUnloadTimer();
    hiding = true;
  });
  window.addEventListener('pageshow', () => {
    clearBeforeUnloadTimer();
    hiding = false;
  });
}

export function isPageHiding(): boolean {
  return hiding;
}
