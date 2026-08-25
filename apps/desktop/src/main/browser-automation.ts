import { randomBytes } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";

import {
  DESKTOP_BROWSER_AUTOMATION_ACTIONS,
  type DesktopBrowserAutomationInput,
  type DesktopBrowserAutomationResult,
} from "@open-design/sidecar-proto";
import {
  OPEN_DESIGN_BROWSER_AUTOMATION_SCOPES,
  type OpenDesignHostBrowserAutomationBeginInput,
  type OpenDesignHostBrowserAutomationBeginResult,
  type OpenDesignHostBrowserAutomationEvent,
  type OpenDesignHostBrowserAutomationLinkInput,
  type OpenDesignHostBrowserAutomationStopResult,
} from "@open-design/host";

export type BrowserAutomationGuest = {
  capturePage(): Promise<{ getSize(): { height: number; width: number }; toDataURL(): string }>;
  executeJavaScript<T = unknown>(code: string, userGesture?: boolean): Promise<T>;
  getURL(): string;
  id: number;
  isDestroyed(): boolean;
  loadURL(url: string): Promise<void>;
  sendInputEvent(event: BrowserAutomationInputEvent): void;
};

export type BrowserAutomationInputEvent = {
  button?: "left";
  canScroll?: boolean;
  clickCount?: number;
  deltaX?: number;
  deltaY?: number;
  type: "mouseDown" | "mouseMove" | "mouseUp" | "mouseWheel";
  x: number;
  y: number;
};

type PointerPoint = { x: number; y: number };

type PointerTarget = PointerPoint & {
  found: true;
  height: number;
  hitSafe: boolean;
  tag: string;
  viewportHeight: number;
  viewportWidth: number;
  width: number;
};

type MissingPointerTarget = { found: false };

type BrowserAutomationSessionRecord = {
  expiresAtMs: number | null;
  guestWebContentsId: number;
  origin: string;
  pointer: PointerPoint | null;
  projectDir: string | null;
  projectId: string;
  sessionId: string;
  stopped: boolean;
};

export type BrowserAutomationService = {
  begin(input: OpenDesignHostBrowserAutomationBeginInput): OpenDesignHostBrowserAutomationBeginResult;
  execute(input: DesktopBrowserAutomationInput): Promise<DesktopBrowserAutomationResult>;
  handleGuestNavigation(guestWebContentsId: number, url: string): void;
  link(input: OpenDesignHostBrowserAutomationLinkInput): OpenDesignHostBrowserAutomationBeginResult;
  revokeGuest(guestWebContentsId: number, message?: string): void;
  stop(sessionId: string, message?: string): OpenDesignHostBrowserAutomationStopResult;
  stopAll(message?: string): void;
};

export type BrowserAutomationServiceOptions = {
  emit(event: OpenDesignHostBrowserAutomationEvent): void;
  getGuest(guestWebContentsId: number): BrowserAutomationGuest | null;
  now?: () => number;
  token?: () => string;
  wait?: (milliseconds: number) => Promise<void>;
};

function httpOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

export function redactBrowserAutomationUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/(?:token|secret|auth|password|passwd|session|code|key)/i.test(key)) {
        url.searchParams.set(key, "[redacted]");
      }
    }
    return url.toString();
  } catch {
    return "";
  }
}

function actionError(input: DesktopBrowserAutomationInput, error: string): DesktopBrowserAutomationResult {
  return { action: input.action, error, ok: false, sessionId: input.sessionId };
}

export const BROWSER_AUTOMATION_PAGE_INFO_SCRIPT = `(() => {
  const attr = (selector, name) => document.querySelector(selector)?.getAttribute(name) || undefined;
  const safeUrl = (value) => {
    if (!value) return undefined;
    try {
      const url = new URL(value, location.href);
      url.hash = '';
      for (const key of Array.from(url.searchParams.keys())) {
        if (/(?:token|secret|auth|password|passwd|session|code|key)/i.test(key)) url.searchParams.set(key, '[redacted]');
      }
      return url.href;
    } catch { return undefined; }
  };
  return {
    title: document.title,
    url: safeUrl(location.href),
    description: attr('meta[name="description"],meta[property="og:description"]', 'content'),
    canonical: safeUrl(attr('link[rel="canonical"]', 'href')),
    ogImage: safeUrl(attr('meta[property="og:image"],meta[name="twitter:image"]', 'content')),
    themeColor: attr('meta[name="theme-color"]', 'content'),
    favicon: safeUrl(attr('link[rel~="icon"]', 'href')),
    viewport: { width: innerWidth, height: innerHeight },
    scroll: { x: scrollX, y: scrollY, maxY: Math.max(0, document.documentElement.scrollHeight - innerHeight) }
  };
})()`;

// Values entered into form controls are intentionally omitted. The snapshot is
// a bounded, accessibility-oriented map that lets an agent choose a selector
// without exposing passwords, tokens, or other typed content.
export const BROWSER_AUTOMATION_SNAPSHOT_SCRIPT = `(() => {
  const selectorFor = (element) => {
    if (element.id && globalThis.CSS && typeof CSS.escape === 'function') return '#' + CSS.escape(element.id);
    const testId = element.getAttribute('data-testid');
    if (testId && globalThis.CSS && typeof CSS.escape === 'function') return '[data-testid="' + CSS.escape(testId) + '"]';
    const parts = [];
    let node = element;
    while (node && node.nodeType === 1 && parts.length < 6) {
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((item) => item.tagName === node.tagName);
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  };
  const safeUrl = (value) => {
    if (!value) return undefined;
    try {
      const url = new URL(value, location.href);
      url.hash = '';
      for (const key of Array.from(url.searchParams.keys())) {
        if (/(?:token|secret|auth|password|passwd|session|code|key)/i.test(key)) url.searchParams.set(key, '[redacted]');
      }
      return url.href;
    } catch { return undefined; }
  };
  const candidates = Array.from(document.querySelectorAll(
    'a[href],button,input:not([type="hidden"]),textarea,select,[role="button"],[role="link"],[role="heading"],h1,h2,h3,[contenteditable="true"],[tabindex]:not([tabindex="-1"])'
  )).filter((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  });
  return {
    title: document.title,
    url: safeUrl(location.href),
    elements: candidates.slice(0, 120).map((element, index) => {
      const rect = element.getBoundingClientRect();
      return ({
      index,
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute('role') || undefined,
      type: element.getAttribute('type') || undefined,
      name: element.getAttribute('name') || undefined,
      text: (element.getAttribute('aria-label') || element.getAttribute('title') || element.innerText || element.getAttribute('placeholder') || '').trim().replace(/\\s+/g, ' ').slice(0, 160),
      selector: selectorFor(element),
      href: safeUrl(element.getAttribute('href')),
      bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true')
    }); })
  };
})()`;

export function browserAutomationPointerTargetScript(selector: string): string {
  return `(() => {
    const marker = '__open_agent_pointer_target__';
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return { found: false, marker };
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rect = element.getBoundingClientRect();
    const x = Math.max(1, Math.min(innerWidth - 2, rect.left + rect.width / 2));
    const y = Math.max(1, Math.min(innerHeight - 2, rect.top + rect.height / 2));
    const hit = document.elementFromPoint(x, y);
    return {
      found: rect.width > 0 && rect.height > 0,
      marker,
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      hitSafe: Boolean(hit && (hit === element || element.contains(hit) || hit.contains(element))),
      tag: element.tagName.toLowerCase()
    };
  })()`;
}

export function browserAutomationPointerDragTargetsScript(selector: string, targetSelector: string): string {
  return `(() => {
    const marker = '__open_agent_pointer_drag_targets__';
    const source = document.querySelector(${JSON.stringify(selector)});
    const target = document.querySelector(${JSON.stringify(targetSelector)});
    if (!source || !target) return { found: false, marker };
    source.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const sourceRect = source.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const point = (rect) => ({
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    });
    const from = point(sourceRect);
    const to = point(targetRect);
    const visible = (value) => value.width > 0 && value.height > 0
      && value.x > 0 && value.x < innerWidth && value.y > 0 && value.y < innerHeight;
    return {
      found: visible(from) && visible(to),
      marker,
      from,
      to,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      sourceTag: source.tagName.toLowerCase(),
      targetTag: target.tagName.toLowerCase()
    };
  })()`;
}

export function browserAutomationPointerOverlayScript(
  from: PointerPoint,
  to: PointerPoint,
  action: string,
  durationMs: number,
  pulse: boolean,
): string {
  return `(() => {
    const id = '__open_agent_pointer__';
    let host = document.getElementById(id);
    if (host && !(host instanceof HTMLElement)) {
      host.remove();
      host = null;
    }
    let created = false;
    if (!host) {
      created = true;
      host = document.createElement('div');
      host.id = id;
      host.setAttribute('aria-hidden', 'true');
      host.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;z-index:2147483647;pointer-events:none;contain:layout style;overflow:visible;opacity:1;transition:transform ${durationMs}ms cubic-bezier(.2,.8,.2,1),opacity 160ms ease;';
      const cursor = document.createElement('div');
      cursor.style.cssText = 'position:absolute;left:-2px;top:-2px;width:18px;height:22px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.35));';
      cursor.innerHTML = '<svg viewBox="0 0 18 22" width="18" height="22" xmlns="http://www.w3.org/2000/svg"><path d="M2 1.5 15.2 14l-6.1.7-3.2 5.5L2 1.5Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
      const label = document.createElement('span');
      label.style.cssText = 'position:absolute;left:14px;top:18px;display:inline-flex;align-items:center;height:20px;padding:0 7px;border:1px solid rgba(255,255,255,.22);border-radius:6px;background:#111;color:#fff;box-shadow:0 3px 12px rgba(0,0,0,.28);font:600 10px/1 system-ui,-apple-system,sans-serif;white-space:nowrap;letter-spacing:.01em;';
      label.textContent = 'MonoField';
      const ring = document.createElement('i');
      ring.dataset.openAgentPointerRing = 'true';
      ring.style.cssText = 'position:absolute;left:-11px;top:-11px;width:22px;height:22px;border:2px solid #7698fd;border-radius:999px;opacity:0;transform:scale(.4);';
      host.append(cursor, label, ring);
      (document.documentElement || document.body).appendChild(host);
    }
    host.dataset.action = ${JSON.stringify(action)};
    host.style.opacity = '1';
    if (created) {
      host.style.transition = 'none';
      host.style.transform = 'translate3d(${from.x}px,${from.y}px,0)';
      host.getBoundingClientRect();
      host.style.transition = 'transform ${durationMs}ms cubic-bezier(.2,.8,.2,1),opacity 160ms ease';
    }
    requestAnimationFrame(() => { host.style.transform = 'translate3d(${to.x}px,${to.y}px,0)'; });
    const ring = host.querySelector('[data-open-agent-pointer-ring]');
    if (${pulse ? "true" : "false"} && ring && typeof ring.animate === 'function') {
      ring.animate(
        [{ opacity: 0.9, transform: 'scale(.45)' }, { opacity: 0, transform: 'scale(1.45)' }],
        { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' }
      );
    }
    clearTimeout(globalThis.__openAgentPointerIdleTimer);
    globalThis.__openAgentPointerIdleTimer = setTimeout(() => {
      const current = document.getElementById(id);
      if (current) current.style.opacity = '.34';
    }, 1100);
    return true;
  })()`;
}

const REMOVE_AGENT_POINTER_SCRIPT = `(() => {
  clearTimeout(globalThis.__openAgentPointerIdleTimer);
  document.getElementById('__open_agent_pointer__')?.remove();
  return true;
})()`;

function clickScript(selector: string): string {
  return `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return { found: false, clicked: false };
    element.scrollIntoView({ block: 'center', inline: 'center' });
    if (typeof element.click === 'function') element.click();
    else element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return { found: true, clicked: true, tag: element.tagName.toLowerCase() };
  })()`;
}

function typeTextScript(selector: string, text: string): string {
  return `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return { found: false, typed: false };
    const tag = element.tagName.toLowerCase();
    const type = String(element.getAttribute('type') || '').toLowerCase();
    const autocomplete = String(element.getAttribute('autocomplete') || '').toLowerCase();
    const identity = [element.id, element.getAttribute('name'), element.getAttribute('aria-label')]
      .filter(Boolean).join(' ').toLowerCase();
    const sensitive = type === 'password'
      || ['current-password', 'new-password', 'one-time-code', 'cc-number', 'cc-csc'].includes(autocomplete)
      || /(?:password|passwd|secret|token|otp|one.?time|credit.?card|card.?number|cvv|cvc|ssn)/i.test(identity);
    if (sensitive) return { found: true, typed: false, blocked: true, reason: 'sensitive-field' };
    if (!(tag === 'input' || tag === 'textarea' || element.isContentEditable)) {
      return { found: true, typed: false, reason: 'not-editable' };
    }
    element.focus();
    const text = ${JSON.stringify(text)};
    if (element.isContentEditable) element.textContent = text;
    else {
      const prototype = tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(element, text);
      else element.value = text;
    }
    element.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return { found: true, typed: true, blocked: false, tag };
  })()`;
}

function scrollScript(input: DesktopBrowserAutomationInput): string {
  if (input.to === "top") return `(() => { scrollTo({ top: 0, behavior: 'instant' }); return { x: scrollX, y: scrollY }; })()`;
  if (input.to === "bottom") return `(() => { scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }); return { x: scrollX, y: scrollY }; })()`;
  if (input.to === "page") return `(() => { scrollBy({ top: Math.max(200, innerHeight * 0.8), behavior: 'instant' }); return { x: scrollX, y: scrollY }; })()`;
  return `(() => { scrollBy({ top: ${Number(input.pixels ?? 0)}, behavior: 'instant' }); return { x: scrollX, y: scrollY }; })()`;
}

function hoverScript(selector: string): string {
  return `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return { found: false, hovered: false };
    element.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = element.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, view: window };
    if (typeof PointerEvent === 'function') {
      element.dispatchEvent(new PointerEvent('pointerover', init));
      element.dispatchEvent(new PointerEvent('pointerenter', { ...init, bubbles: false }));
      element.dispatchEvent(new PointerEvent('pointermove', init));
    }
    element.dispatchEvent(new MouseEvent('mouseover', init));
    element.dispatchEvent(new MouseEvent('mouseenter', { ...init, bubbles: false }));
    element.dispatchEvent(new MouseEvent('mousemove', init));
    return { found: true, hovered: true, tag: element.tagName.toLowerCase(), bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
  })()`;
}

function dragScript(selector: string, targetSelector: string): string {
  return `(() => {
    const source = document.querySelector(${JSON.stringify(selector)});
    const target = document.querySelector(${JSON.stringify(targetSelector)});
    if (!source || !target) return { foundSource: Boolean(source), foundTarget: Boolean(target), dragged: false };
    source.scrollIntoView({ block: 'center', inline: 'center' });
    target.scrollIntoView({ block: 'center', inline: 'center' });
    const transfer = new DataTransfer();
    const fire = (element, type) => element.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
    const started = fire(source, 'dragstart');
    fire(target, 'dragenter');
    fire(target, 'dragover');
    const dropped = fire(target, 'drop');
    fire(source, 'dragend');
    return { foundSource: true, foundTarget: true, dragged: true, dragStartAccepted: started, dropAccepted: dropped };
  })()`;
}

function isPointerTarget(value: unknown): value is PointerTarget {
  if (value == null || typeof value !== "object") return false;
  const target = value as Partial<PointerTarget>;
  return target.found === true
    && Number.isFinite(target.x)
    && Number.isFinite(target.y)
    && Number.isFinite(target.viewportWidth)
    && Number.isFinite(target.viewportHeight)
    && typeof target.tag === "string";
}

function pointerFallbackReason(target: MissingPointerTarget | PointerTarget | unknown): string {
  if (!isPointerTarget(target)) return "target geometry was unavailable";
  if (!target.hitSafe) return "the target center was covered by another element";
  return "native pointer input was unavailable";
}

async function moveNativePointer(
  guest: BrowserAutomationGuest,
  session: BrowserAutomationSessionRecord,
  target: PointerPoint & { viewportHeight: number; viewportWidth: number },
  action: string,
  wait: (milliseconds: number) => Promise<void>,
  options: { buttonDown?: boolean; durationMs?: number; pulse?: boolean } = {},
): Promise<void> {
  const durationMs = options.durationMs ?? 140;
  const from = session.pointer ?? {
    x: Math.round(target.viewportWidth / 2),
    y: Math.round(target.viewportHeight / 2),
  };
  await guest.executeJavaScript(
    browserAutomationPointerOverlayScript(from, target, action, durationMs, options.pulse === true),
    false,
  );
  const distance = Math.hypot(target.x - from.x, target.y - from.y);
  const steps = Math.max(2, Math.min(10, Math.ceil(distance / 90)));
  for (let step = 1; step <= steps; step += 1) {
    if (session.stopped) throw new Error("Browser automation stopped");
    const progress = step / steps;
    const eased = 1 - (1 - progress) ** 3;
    guest.sendInputEvent({
      ...(options.buttonDown ? { button: "left" as const } : {}),
      type: "mouseMove",
      x: Math.round(from.x + (target.x - from.x) * eased),
      y: Math.round(from.y + (target.y - from.y) * eased),
    });
    if (step < steps) await wait(Math.max(8, Math.round(durationMs / steps)));
  }
  session.pointer = { x: target.x, y: target.y };
}

async function pointerClick(
  guest: BrowserAutomationGuest,
  session: BrowserAutomationSessionRecord,
  selector: string,
  wait: (milliseconds: number) => Promise<void>,
): Promise<{ clicked: boolean; fallbackReason?: string; found: boolean; mode: "dom-fallback" | "pointer"; tag?: string }> {
  const target = await guest.executeJavaScript<MissingPointerTarget | PointerTarget>(browserAutomationPointerTargetScript(selector), true);
  if (isPointerTarget(target) && target.hitSafe) {
    try {
      await moveNativePointer(guest, session, target, "click", wait, { pulse: true });
      guest.sendInputEvent({ button: "left", clickCount: 1, type: "mouseDown", x: target.x, y: target.y });
      await wait(32);
      if (session.stopped) throw new Error("Browser automation stopped");
      guest.sendInputEvent({ button: "left", clickCount: 1, type: "mouseUp", x: target.x, y: target.y });
      return { clicked: true, found: true, mode: "pointer", tag: target.tag };
    } catch (error) {
      if (session.stopped) throw error;
    }
  }
  const fallback = await guest.executeJavaScript<{ clicked?: boolean; found?: boolean; tag?: string }>(clickScript(selector), true);
  return {
    clicked: fallback?.clicked === true,
    fallbackReason: pointerFallbackReason(target),
    found: fallback?.found === true,
    mode: "dom-fallback",
    ...(typeof fallback?.tag === "string" ? { tag: fallback.tag } : {}),
  };
}

async function pointerHover(
  guest: BrowserAutomationGuest,
  session: BrowserAutomationSessionRecord,
  selector: string,
  wait: (milliseconds: number) => Promise<void>,
): Promise<{ fallbackReason?: string; found: boolean; hovered: boolean; mode: "dom-fallback" | "pointer"; tag?: string }> {
  const target = await guest.executeJavaScript<MissingPointerTarget | PointerTarget>(browserAutomationPointerTargetScript(selector), true);
  if (isPointerTarget(target) && target.hitSafe) {
    try {
      await moveNativePointer(guest, session, target, "hover", wait);
      return { found: true, hovered: true, mode: "pointer", tag: target.tag };
    } catch (error) {
      if (session.stopped) throw error;
    }
  }
  const fallback = await guest.executeJavaScript<{ found?: boolean; hovered?: boolean; tag?: string }>(hoverScript(selector), true);
  return {
    fallbackReason: pointerFallbackReason(target),
    found: fallback?.found === true,
    hovered: fallback?.hovered === true,
    mode: "dom-fallback",
    ...(typeof fallback?.tag === "string" ? { tag: fallback.tag } : {}),
  };
}

type PointerDragTargets = {
  found: true;
  from: PointerPoint & { height: number; width: number };
  sourceTag: string;
  targetTag: string;
  to: PointerPoint & { height: number; width: number };
  viewportHeight: number;
  viewportWidth: number;
};

function isPointerDragTargets(value: unknown): value is PointerDragTargets {
  if (value == null || typeof value !== "object") return false;
  const targets = value as Partial<PointerDragTargets>;
  return targets.found === true
    && targets.from != null
    && targets.to != null
    && Number.isFinite(targets.from.x)
    && Number.isFinite(targets.from.y)
    && Number.isFinite(targets.to.x)
    && Number.isFinite(targets.to.y)
    && Number.isFinite(targets.viewportWidth)
    && Number.isFinite(targets.viewportHeight);
}

async function pointerDrag(
  guest: BrowserAutomationGuest,
  session: BrowserAutomationSessionRecord,
  selector: string,
  targetSelector: string,
  wait: (milliseconds: number) => Promise<void>,
): Promise<unknown> {
  const targets = await guest.executeJavaScript<PointerDragTargets | { found: false }>(
    browserAutomationPointerDragTargetsScript(selector, targetSelector),
    true,
  );
  if (isPointerDragTargets(targets)) {
    try {
      await moveNativePointer(
        guest,
        session,
        { ...targets.from, viewportHeight: targets.viewportHeight, viewportWidth: targets.viewportWidth },
        "drag",
        wait,
      );
      guest.sendInputEvent({ button: "left", clickCount: 1, type: "mouseDown", x: targets.from.x, y: targets.from.y });
      await wait(48);
      await moveNativePointer(
        guest,
        session,
        { ...targets.to, viewportHeight: targets.viewportHeight, viewportWidth: targets.viewportWidth },
        "drag",
        wait,
        { buttonDown: true, durationMs: 240, pulse: true },
      );
      if (session.stopped) throw new Error("Browser automation stopped");
      guest.sendInputEvent({ button: "left", clickCount: 1, type: "mouseUp", x: targets.to.x, y: targets.to.y });
      return {
        dragged: true,
        foundSource: true,
        foundTarget: true,
        mode: "pointer",
        sourceTag: targets.sourceTag,
        targetTag: targets.targetTag,
      };
    } catch (error) {
      if (session.stopped) throw error;
    }
  }
  const fallback = await guest.executeJavaScript<Record<string, unknown>>(dragScript(selector, targetSelector), true);
  return { ...fallback, fallbackReason: "both drag targets were not safely visible", mode: "dom-fallback" };
}

function mimeTypeForFile(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    case ".svg": return "image/svg+xml";
    case ".pdf": return "application/pdf";
    case ".json": return "application/json";
    case ".txt":
    case ".md": return "text/plain";
    case ".csv": return "text/csv";
    default: return "application/octet-stream";
  }
}

function projectUploadFile(session: BrowserAutomationSessionRecord, filePath: string): { base64: string; mimeType: string; name: string; size: number } {
  if (!session.projectDir) throw new Error("File upload requires a connected project folder");
  const root = resolve(session.projectDir);
  const target = resolve(isAbsolute(filePath) ? filePath : resolve(root, filePath));
  const fromRoot = relative(root, target);
  if (!fromRoot || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error("File upload is limited to the connected project folder");
  }
  const stat = statSync(target);
  if (!stat.isFile()) throw new Error("Upload target must be a file");
  if (stat.size > 25 * 1024 * 1024) throw new Error("Browser uploads are limited to 25 MB per file");
  return {
    base64: readFileSync(target).toString("base64"),
    mimeType: mimeTypeForFile(target),
    name: basename(target),
    size: stat.size,
  };
}

function uploadScript(selector: string, file: { base64: string; mimeType: string; name: string }): string {
  return `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return { found: false, uploaded: false };
    if (!(element instanceof HTMLInputElement) || element.type !== 'file') {
      return { found: true, uploaded: false, reason: 'not-file-input' };
    }
    const raw = atob(${JSON.stringify(file.base64)});
    const bytes = new Uint8Array(raw.length);
    for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([bytes], ${JSON.stringify(file.name)}, { type: ${JSON.stringify(file.mimeType)} }));
    element.files = dataTransfer.files;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return { found: true, uploaded: true, fileName: ${JSON.stringify(file.name)}, fileType: ${JSON.stringify(file.mimeType)} };
  })()`;
}

export function createBrowserAutomationService(options: BrowserAutomationServiceOptions): BrowserAutomationService {
  const sessions = new Map<string, BrowserAutomationSessionRecord>();
  const now = options.now ?? Date.now;
  const token = options.token ?? (() => randomBytes(32).toString("base64url"));
  const wait = options.wait ?? ((milliseconds: number) => new Promise<void>((resolveWait) => {
    setTimeout(resolveWait, milliseconds);
  }));

  const emit = (
    session: BrowserAutomationSessionRecord,
    type: OpenDesignHostBrowserAutomationEvent["type"],
    ok: boolean,
    message: string,
    action?: string,
  ): void => options.emit({ action, at: new Date(now()).toISOString(), message, ok, sessionId: session.sessionId, type });

  const stopRecord = (session: BrowserAutomationSessionRecord, type: "stopped" | "expired" | "revoked", message: string): void => {
    if (!sessions.delete(session.sessionId)) return;
    session.stopped = true;
    session.pointer = null;
    const guest = options.getGuest(session.guestWebContentsId);
    if (guest != null && !guest.isDestroyed()) {
      void guest.executeJavaScript(REMOVE_AGENT_POINTER_SCRIPT, false).catch(() => undefined);
    }
    emit(session, type, true, message);
  };

  const performStep = async (
    input: DesktopBrowserAutomationInput,
    session: BrowserAutomationSessionRecord,
    guest: BrowserAutomationGuest,
  ): Promise<unknown> => {
    if (session.stopped) throw new Error("Browser automation stopped");
    switch (input.action) {
      case DESKTOP_BROWSER_AUTOMATION_ACTIONS.STATUS:
        return { expiresAt: null, origin: session.origin, url: redactBrowserAutomationUrl(guest.getURL()) };
      case DESKTOP_BROWSER_AUTOMATION_ACTIONS.PAGE_INFO:
        return await guest.executeJavaScript(BROWSER_AUTOMATION_PAGE_INFO_SCRIPT, false);
      case DESKTOP_BROWSER_AUTOMATION_ACTIONS.SNAPSHOT:
        return await guest.executeJavaScript(BROWSER_AUTOMATION_SNAPSHOT_SCRIPT, false);
      case DESKTOP_BROWSER_AUTOMATION_ACTIONS.SCREENSHOT: {
        const image = await guest.capturePage();
        const size = image.getSize();
        return { dataUrl: image.toDataURL(), height: size.height, width: size.width };
      }
      case DESKTOP_BROWSER_AUTOMATION_ACTIONS.CLICK:
        return await pointerClick(guest, session, input.selector!, wait);
      case DESKTOP_BROWSER_AUTOMATION_ACTIONS.HOVER:
        return await pointerHover(guest, session, input.selector!, wait);
      case DESKTOP_BROWSER_AUTOMATION_ACTIONS.DRAG:
        return await pointerDrag(guest, session, input.selector!, input.targetSelector!, wait);
      case DESKTOP_BROWSER_AUTOMATION_ACTIONS.TYPE_TEXT: {
        const target = await guest.executeJavaScript<MissingPointerTarget | PointerTarget>(browserAutomationPointerTargetScript(input.selector!), true);
        if (isPointerTarget(target) && target.hitSafe) {
          await moveNativePointer(guest, session, target, "type-text", wait, { pulse: true });
          guest.sendInputEvent({ button: "left", clickCount: 1, type: "mouseDown", x: target.x, y: target.y });
          guest.sendInputEvent({ button: "left", clickCount: 1, type: "mouseUp", x: target.x, y: target.y });
        }
        const data = await guest.executeJavaScript(typeTextScript(input.selector!, input.text!), true);
        if ((data as { blocked?: boolean } | null)?.blocked === true) throw new Error("Typing into sensitive fields is blocked");
        return { ...(data as object), mode: isPointerTarget(target) && target.hitSafe ? "pointer+dom-input" : "dom" };
      }
      case DESKTOP_BROWSER_AUTOMATION_ACTIONS.UPLOAD: {
        const file = projectUploadFile(session, input.filePath!);
        const target = await guest.executeJavaScript<MissingPointerTarget | PointerTarget>(browserAutomationPointerTargetScript(input.selector!), false);
        if (isPointerTarget(target) && target.hitSafe) {
          await moveNativePointer(guest, session, target, "upload", wait);
        }
        const data = await guest.executeJavaScript(uploadScript(input.selector!, file), true);
        if ((data as { uploaded?: boolean } | null)?.uploaded !== true) throw new Error("The selected element did not accept the project file");
        return { ...(data as object), size: file.size };
      }
      case DESKTOP_BROWSER_AUTOMATION_ACTIONS.SCROLL:
        return await guest.executeJavaScript(scrollScript(input), true);
      case DESKTOP_BROWSER_AUTOMATION_ACTIONS.NAVIGATE: {
        const target = new URL(input.url!);
        if ((target.protocol !== "http:" && target.protocol !== "https:") || target.origin !== session.origin) {
          throw new Error("Navigation is limited to the approved origin");
        }
        await guest.loadURL(target.href);
        if (httpOrigin(guest.getURL()) !== session.origin) {
          stopRecord(session, "revoked", "Navigation left the approved origin");
          throw new Error("Navigation left the approved origin");
        }
        return { title: await guest.executeJavaScript("document.title", false), url: redactBrowserAutomationUrl(guest.getURL()) };
      }
      case DESKTOP_BROWSER_AUTOMATION_ACTIONS.BATCH: {
        const results: Array<{ action: string; data?: unknown; error?: string; ok: boolean }> = [];
        for (const step of input.steps ?? []) {
          const stepInput = { ...step, sessionId: input.sessionId } as DesktopBrowserAutomationInput;
          try {
            const data = await performStep(stepInput, session, guest);
            results.push({ action: step.action, data, ok: true });
            emit(session, "operation", true, `${step.action} completed`, step.action);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            results.push({ action: step.action, error: message, ok: false });
            emit(session, "operation", false, message, step.action);
            if (!input.continueOnError) {
              throw new Error(`Batch step ${results.length} (${step.action}) failed: ${message}`);
            }
          }
        }
        return { results };
      }
    }
  };

  return {
    begin(input) {
      if (!Number.isInteger(input.guestWebContentsId) || input.guestWebContentsId <= 0 || !input.projectId.trim()) {
        return { ok: false, reason: "Invalid browser automation session request" };
      }
      const guest = options.getGuest(input.guestWebContentsId);
      if (guest == null || guest.isDestroyed()) return { ok: false, reason: "The selected in-app browser tab is not attached" };
      const requestedOrigin = httpOrigin(input.origin);
      const currentOrigin = httpOrigin(guest.getURL());
      if (requestedOrigin == null || currentOrigin !== requestedOrigin) {
        return { ok: false, reason: "The browser origin changed before approval" };
      }
      for (const record of sessions.values()) {
        if (record.guestWebContentsId === input.guestWebContentsId) stopRecord(record, "revoked", "Replaced by a newly approved session");
      }
      const session: BrowserAutomationSessionRecord = {
        // The user has explicitly granted this tab/origin permission. Keep it
        // active until Stop, tab close, origin change, or app shutdown.
        expiresAtMs: null,
        guestWebContentsId: input.guestWebContentsId,
        origin: requestedOrigin,
        pointer: null,
        projectDir: input.projectDir ? resolve(input.projectDir) : null,
        projectId: input.projectId,
        sessionId: token(),
        stopped: false,
      };
      sessions.set(session.sessionId, session);
      emit(session, "started", true, `Approved for ${session.origin}`);
      return {
        expiresAt: null,
        ok: true,
        origin: session.origin,
        scopes: OPEN_DESIGN_BROWSER_AUTOMATION_SCOPES,
        sessionId: session.sessionId,
      };
    },

    link(input) {
      const parent = sessions.get(input.parentSessionId);
      if (parent == null) return { ok: false, reason: "The parent browser automation session is not active" };
      if (parent.projectId !== input.projectId) return { ok: false, reason: "Browser automation cannot be linked across projects" };
      if (!Number.isInteger(input.guestWebContentsId) || input.guestWebContentsId <= 0) {
        return { ok: false, reason: "Invalid browser automation link request" };
      }
      const guest = options.getGuest(input.guestWebContentsId);
      if (guest == null || guest.isDestroyed()) return { ok: false, reason: "The popup browser tab is not attached" };
      const requestedOrigin = httpOrigin(input.origin);
      const currentOrigin = httpOrigin(guest.getURL());
      if (requestedOrigin == null || requestedOrigin !== parent.origin || currentOrigin !== parent.origin) {
        return { ok: false, reason: "Only same-origin popup tabs inherit browser automation" };
      }
      for (const record of sessions.values()) {
        if (record.guestWebContentsId === input.guestWebContentsId) stopRecord(record, "revoked", "Replaced by a linked popup session");
      }
      const session: BrowserAutomationSessionRecord = {
        expiresAtMs: null,
        guestWebContentsId: input.guestWebContentsId,
        origin: parent.origin,
        pointer: null,
        projectDir: parent.projectDir,
        projectId: parent.projectId,
        sessionId: token(),
        stopped: false,
      };
      sessions.set(session.sessionId, session);
      emit(session, "started", true, `Inherited approval for ${session.origin}`);
      return {
        expiresAt: null,
        ok: true,
        origin: session.origin,
        scopes: OPEN_DESIGN_BROWSER_AUTOMATION_SCOPES,
        sessionId: session.sessionId,
      };
    },

    async execute(input) {
      const session = sessions.get(input.sessionId);
      if (session == null) return actionError(input, "Browser automation session is not active");
      const guest = options.getGuest(session.guestWebContentsId);
      if (guest == null || guest.isDestroyed()) {
        stopRecord(session, "revoked", "The approved browser tab was closed");
        return actionError(input, "The approved browser tab was closed");
      }
      if (httpOrigin(guest.getURL()) !== session.origin) {
        stopRecord(session, "revoked", "The browser navigated outside the approved origin");
        return actionError(input, "The browser origin changed; approve a new session");
      }

      try {
        const data = await performStep(input, session, guest);
        emit(session, "operation", true, `${input.action} completed`, input.action);
        return { action: input.action, data, ok: true, sessionId: input.sessionId };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emit(session, "operation", false, message, input.action);
        return actionError(input, message);
      }
    },

    revokeGuest(guestWebContentsId, message = "The approved browser tab was closed") {
      for (const session of sessions.values()) {
        if (session.guestWebContentsId === guestWebContentsId) stopRecord(session, "revoked", message);
      }
    },

    handleGuestNavigation(guestWebContentsId, url) {
      const origin = httpOrigin(url);
      for (const session of sessions.values()) {
        if (session.guestWebContentsId === guestWebContentsId && origin !== session.origin) {
          stopRecord(session, "revoked", "The browser navigated outside the approved origin");
        }
      }
    },

    stop(sessionId, message = "Stopped by the user") {
      const session = sessions.get(sessionId);
      if (session == null) return { ok: true, stopped: false };
      stopRecord(session, "stopped", message);
      return { ok: true, stopped: true };
    },

    stopAll(message = "MonoField is closing") {
      for (const session of [...sessions.values()]) stopRecord(session, "stopped", message);
    },
  };
}
