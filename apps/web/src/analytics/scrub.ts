// Pure privacy scrubbing helpers retained for local tests and defensive
// exception-string cleanup. MonoField does not send product telemetry.

export type CaptureResult = {
  event: string;
  properties: Record<string, unknown>;
};

const TEXT_BEARING_TAGS = new Set(['input', 'textarea']);

function scrubElementsChain(
  elements: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return elements.map((el) => {
    const tag = typeof el.tag_name === 'string' ? el.tag_name.toLowerCase() : '';
    const contentEditable =
      typeof el.attr__contenteditable === 'string' && el.attr__contenteditable !== 'false';
    const isPasswordInput =
      tag === 'input' &&
      typeof el.attr__type === 'string' &&
      el.attr__type.toLowerCase() === 'password';
    const shouldScrub = TEXT_BEARING_TAGS.has(tag) || contentEditable || isPasswordInput;
    if (!shouldScrub) return el;
    const cleaned: Record<string, unknown> = { ...el };
    delete cleaned.$el_text;
    delete cleaned.attr__value;
    delete cleaned.attr__placeholder;
    delete cleaned.attr__aria_label;
    delete cleaned.text;
    return cleaned;
  });
}

function scrubUrl(url: unknown): unknown {
  if (typeof url !== 'string') return url;
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

export function scrubFilePath(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value.replace(
    /(?:file:\/\/)?[^()\n]*?\/((?:apps|packages|tools)\/[^\s)]+)/g,
    'app://$1',
  );
}

export function scrubExceptionList(
  list: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return list.map((entry) => {
    const next = { ...entry };
    const stack = next.stacktrace as { frames?: Array<Record<string, unknown>> } | undefined;
    if (stack?.frames && Array.isArray(stack.frames)) {
      next.stacktrace = {
        ...stack,
        frames: stack.frames.map((frame) => ({
          ...frame,
          filename: scrubFilePath(frame.filename),
          abs_path: scrubFilePath(frame.abs_path),
        })),
      };
    }
    if (typeof next.mechanism === 'object' && next.mechanism !== null) {
      const mech = next.mechanism as Record<string, unknown>;
      if (typeof mech.source === 'string') {
        mech.source = scrubFilePath(mech.source);
      }
    }
    return next;
  });
}

const SUPPRESSED_EVENTS = new Set<string>(['$opt_in']);

export function scrubBeforeSend(cr: CaptureResult | null): CaptureResult | null {
  if (!cr) return null;
  if (SUPPRESSED_EVENTS.has(cr.event)) return null;

  const props = (cr.properties ?? {}) as Record<string, unknown>;
  const elementBearing =
    cr.event === '$autocapture' ||
    cr.event === '$rageclick' ||
    cr.event === '$dead_click' ||
    cr.event === '$copy_autocapture';
  if (elementBearing) {
    const elements = props.$elements;
    if (Array.isArray(elements)) {
      props.$elements = scrubElementsChain(elements as Array<Record<string, unknown>>);
    }
  }

  if (typeof props.$current_url === 'string') {
    props.$current_url = scrubUrl(props.$current_url);
  }
  if (typeof props.$referrer === 'string') {
    props.$referrer = scrubUrl(props.$referrer);
  }

  if (cr.event === '$exception') {
    const list = props.$exception_list;
    if (Array.isArray(list)) {
      props.$exception_list = scrubExceptionList(list as Array<Record<string, unknown>>);
    }
    if (typeof props.$exception_source === 'string') {
      props.$exception_source = scrubFilePath(props.$exception_source);
    }
  }

  return { ...cr, properties: props };
}
