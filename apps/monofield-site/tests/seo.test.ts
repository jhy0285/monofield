import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const siteUrl = 'https://monofield.vercel.app';
const [home, notices, robots, sitemap, socialCard, mark, manifestSource, vercelSource] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../open-source.html', import.meta.url), 'utf8'),
  readFile(new URL('../robots.txt', import.meta.url), 'utf8'),
  readFile(new URL('../sitemap.xml', import.meta.url), 'utf8'),
  readFile(new URL('../social-card.png', import.meta.url)),
  readFile(new URL('../mark.svg', import.meta.url), 'utf8'),
  readFile(new URL('../site.webmanifest', import.meta.url), 'utf8'),
  readFile(new URL('../vercel.json', import.meta.url), 'utf8'),
]);

const manifest = JSON.parse(manifestSource);
const vercel = JSON.parse(vercelSource);

function head(source: string) {
  return source.match(/<head>([\s\S]*?)<\/head>/i)?.[1] ?? '';
}

function attribute(source: string, selector: RegExp, name: string) {
  const tag = source.match(selector)?.[0];
  return tag?.match(new RegExp(`${name}="([^"]+)"`, 'i'))?.[1] ?? '';
}

function structuredData(source: string): Array<Record<string, any>> {
  return [...source.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)]
    .map((match) => JSON.parse(match[1]));
}

test('home page exposes one consistent canonical search identity', () => {
  const homeHead = head(home);
  const title = homeHead.match(/<title>([^<]+)<\/title>/)?.[1] ?? '';
  const description = attribute(homeHead, /<meta\s+name="description"[^>]*>/i, 'content');
  assert.equal(title, 'MonoField (모노필드) | Local-first AI workbench');
  assert.equal((homeHead.match(/<title>/gi) ?? []).length, 1);
  assert.equal((homeHead.match(/<meta\s+name="description"/gi) ?? []).length, 1);
  assert.match(description, /^MonoField\(모노필드\) is a local-first AI workbench/);
  assert.equal(
    attribute(homeHead, /<link\s+rel="canonical"[^>]*>/i, 'href'),
    `${siteUrl}/`,
  );
  assert.equal(
    attribute(homeHead, /<meta\s+property="og:url"[^>]*>/i, 'content'),
    `${siteUrl}/`,
  );
  assert.equal(
    attribute(homeHead, /<meta\s+property="og:image"[^>]*>/i, 'content'),
    `${siteUrl}/social-card.png`,
  );
  assert.match(
    attribute(homeHead, /<meta\s+name="robots"[^>]*>/i, 'content'),
    /index, follow.*max-image-preview:large/,
  );
  assert.equal((home.match(/<h1(?:\s|>)/gi) ?? []).length, 1);
  assert.doesNotMatch(homeHead, /hreflang=/i, 'one client-selected URL must not claim separate language URLs');
  assert.doesNotMatch(home, /monifiled/i, 'common misspellings should not be injected as search keywords');
  assert.doesNotMatch(home, /Hellenic|\bOSE\b|aauserver|acrserver|agwserver/i);
});

test('brand icon and web manifest use stable, crawlable identity assets', () => {
  const homeHead = head(home);
  assert.equal(
    attribute(homeHead, /<link\s+rel="icon"[^>]*>/i, 'href'),
    `${siteUrl}/mark.svg`,
  );
  assert.match(mark, /<svg[^>]+width="444"[^>]+height="444"/i);
  assert.equal(manifest.name, 'MonoField');
  assert.equal(manifest.short_name, 'MonoField');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.deepEqual(manifest.icons, [{
    src: '/mark.svg',
    sizes: 'any',
    type: 'image/svg+xml',
    purpose: 'any',
  }]);
  assert.match(homeHead, /<link\s+rel="manifest"\s+href="\/site\.webmanifest"\s*\/?>/i);
});

test('social preview is a crawlable 1200 by 630 PNG', () => {
  assert.equal(socialCard.toString('ascii', 1, 4), 'PNG');
  assert.equal(socialCard.readUInt32BE(16), 1200);
  assert.equal(socialCard.readUInt32BE(20), 630);
  assert.ok(socialCard.byteLength > 5_000);
});

test('home page publishes valid website and free Windows app structured data', () => {
  const graph = structuredData(home)[0]?.['@graph'];
  assert.ok(Array.isArray(graph));

  const website = graph.find((entry) => entry['@type'] === 'WebSite');
  assert.equal(website?.url, `${siteUrl}/`);
  assert.equal(website?.name, 'MonoField');
  assert.deepEqual(website?.alternateName, ['모노필드', 'monofield.vercel.app']);

  const app = graph.find((entry) => entry['@type'] === 'SoftwareApplication');
  assert.equal(app?.name, 'MonoField');
  assert.equal(app?.operatingSystem, 'Windows');
  assert.equal(app?.offers?.price, '0');
  assert.equal(app?.offers?.priceCurrency, 'USD');
  assert.equal(app?.offers?.availability, 'https://schema.org/InStock');
  assert.equal(app?.sameAs, 'https://github.com/jhy0285/monofield');
  assert.equal(app?.image, `${siteUrl}/social-card.png`);
  assert.match(app?.downloadUrl ?? '', /^https:\/\/github\.com\/jhy0285\/monofield\/releases\//);
});

test('secondary page has unique metadata and the clean canonical URL', () => {
  const noticesHead = head(notices);
  assert.match(noticesHead, /<title>Open-source notices \| MonoField<\/title>/);
  assert.equal(
    attribute(noticesHead, /<link\s+rel="canonical"[^>]*>/i, 'href'),
    `${siteUrl}/open-source`,
  );
  assert.equal(
    attribute(noticesHead, /<meta\s+property="og:url"[^>]*>/i, 'content'),
    `${siteUrl}/open-source`,
  );
  assert.equal(structuredData(notices)[0]?.['@type'], 'WebPage');
  assert.equal(
    attribute(noticesHead, /<meta\s+property="og:image:width"[^>]*>/i, 'content'),
    '1200',
  );
  assert.equal(
    attribute(noticesHead, /<meta\s+name="twitter:image:alt"[^>]*>/i, 'content'),
    'MonoField — one workspace for code, design, and documents',
  );
});

test('robots and sitemap advertise only absolute canonical URLs', () => {
  assert.match(robots, /^User-agent: \*\r?\nAllow: \/$/m);
  assert.match(robots, new RegExp(`Sitemap: ${siteUrl.replaceAll('.', '\\.')}\/sitemap\\.xml`));
  assert.match(sitemap, new RegExp(`<loc>${siteUrl.replaceAll('.', '\\.')}\/<\/loc>`));
  assert.match(sitemap, new RegExp(`<loc>${siteUrl.replaceAll('.', '\\.')}\/open-source<\/loc>`));
  assert.doesNotMatch(sitemap, /\.html<\/loc>/);
  assert.equal((sitemap.match(/<url>/g) ?? []).length, 2);
});

test('static hosting serves crawl files with explicit content types and bounded caching', () => {
  const headerRule = (source: string) => vercel.headers.find((rule: any) => rule.source === source);
  const headerValue = (source: string, key: string) => headerRule(source)?.headers
    ?.find((header: any) => header.key.toLowerCase() === key.toLowerCase())?.value;

  assert.equal(headerValue('/robots.txt', 'Content-Type'), 'text/plain; charset=utf-8');
  assert.equal(headerValue('/sitemap.xml', 'Content-Type'), 'application/xml; charset=utf-8');
  assert.equal(headerValue('/site.webmanifest', 'Content-Type'), 'application/manifest+json; charset=utf-8');
  assert.match(headerValue('/robots.txt', 'Cache-Control') ?? '', /must-revalidate/);
  assert.match(headerValue('/sitemap.xml', 'Cache-Control') ?? '', /must-revalidate/);
});
