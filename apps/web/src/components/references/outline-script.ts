/**
 * Runs inside the browsed page (the desktop `<webview>` guest) and returns the page's structure only: top-level
 * landmarks, heading counts per level, form fields (type, short label, required), table headers and row counts, and
 * control counts. No body text, image or link URLs, colours or fonts. The daemon validates and clips it again
 * (`normalizeReferenceOutline`), because the page can change what this returns.
 */
export const REFERENCE_OUTLINE_SCRIPT = `(() => {
  const clean = (value, limit) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, limit);
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const TAGS = { HEADER: 'header', NAV: 'nav', MAIN: 'main', ASIDE: 'aside', FOOTER: 'footer', FORM: 'form', SECTION: 'section', DIALOG: 'dialog', SEARCH: 'search' };
  const ROLES = { banner: 'header', navigation: 'nav', main: 'main', complementary: 'aside', contentinfo: 'footer', form: 'form', search: 'search', dialog: 'dialog', region: 'section' };
  const landmark = (element) => ROLES[element.getAttribute('role') || ''] || TAGS[element.tagName] || '';
  const body = document.body;
  const regions = [];
  if (body) {
    for (const element of Array.from(body.querySelectorAll('header,nav,main,aside,footer,form,section,dialog,search,[role]'))) {
      const name = landmark(element);
      if (!name || !visible(element)) continue;
      let parent = element.parentElement;
      let nested = false;
      while (parent && parent !== body) { if (landmark(parent)) { nested = true; break; } parent = parent.parentElement; }
      if (!nested) regions.push(name);
      if (regions.length >= 24) break;
    }
  }
  const headings = [1, 2, 3, 4, 5, 6].map((level) => ({
    level,
    count: Array.from(document.querySelectorAll('h' + level + ',[role="heading"][aria-level="' + level + '"]')).filter(visible).length,
  })).filter((item) => item.count > 0);
  const labelOf = (field) => {
    const byFor = field.id ? document.querySelector('label[for="' + CSS.escape(field.id) + '"]') : null;
    const wrapping = field.closest('label');
    return clean((byFor && byFor.textContent) || (wrapping && wrapping.textContent) || field.getAttribute('aria-label') || field.getAttribute('placeholder') || field.getAttribute('name') || '', 60);
  };
  const SKIP = new Set(['hidden', 'submit', 'button', 'reset', 'image']);
  const fieldsIn = (scope) => Array.from(scope.querySelectorAll('input,select,textarea'))
    .filter((field) => !SKIP.has((field.getAttribute('type') || '').toLowerCase()) && visible(field))
    .slice(0, 30)
    .map((field) => ({
      type: field.tagName === 'INPUT' ? (field.getAttribute('type') || 'text').toLowerCase() : field.tagName.toLowerCase(),
      label: labelOf(field),
      required: field.required === true || field.getAttribute('aria-required') === 'true',
    }));
  const buttonsIn = (scope) => Array.from(scope.querySelectorAll('button,[role="button"],input[type="submit"],input[type="button"]')).filter(visible).length;
  let forms = Array.from(document.forms).filter(visible).slice(0, 6).map((form) => ({ fields: fieldsIn(form), buttons: buttonsIn(form) }))
    .filter((form) => form.fields.length > 0);
  if (forms.length === 0) {
    const loose = fieldsIn(document);
    if (loose.length) forms = [{ fields: loose, buttons: 0 }];
  }
  const tables = Array.from(document.querySelectorAll('table,[role="table"],[role="grid"]')).filter(visible).slice(0, 6).map((table) => {
    const headers = Array.from(table.querySelectorAll('thead th,[role="columnheader"]'));
    const firstRow = table.querySelector('tr');
    const cells = headers.length ? headers : firstRow ? Array.from(firstRow.children) : [];
    const rows = table.querySelectorAll('tbody tr,[role="row"]').length;
    return { columns: cells.slice(0, 16).map((cell) => clean(cell.textContent, 60)), rows };
  });
  const count = (selector) => Array.from(document.querySelectorAll(selector)).filter(visible).length;
  return {
    regions,
    headings,
    forms,
    tables,
    controls: {
      links: count('a[href]'),
      buttons: count('button,[role="button"]'),
      inputs: count('input:not([type="hidden"]),select,textarea'),
      images: count('img,svg[role="img"],picture'),
    },
    viewport: { width: window.innerWidth, height: window.innerHeight },
  };
})()`;
