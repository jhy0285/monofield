import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const siteUrl = 'https://monofield.vercel.app';
const [home, notices, robots, sitemap, socialCard] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../open-source.html', import.meta.url), 'utf8'),
  readFile(new URL('../robots.txt', import.meta.url), 'utf8'),
  readFile(new URL('../sitemap.xml', import.meta.url), 'utf8'),
  readFile(new URL('../social-card.png', import.meta.url)),
]);

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
  assert.equal(title, 'MonoField | Local-first AI workbench');
  assert.ok([...title].length <= 40, 'title should stay within Naver\'s recommended length');
  assert.ok([...description].length <= 80, 'description should stay within Naver\'s recommended length');
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
    description,
    /MonoField.*모노필드/,
  );
  assert.match(
    attribute(homeHead, /<meta\s+name="robots"[^>]*>/i, 'content'),
    /index, follow.*max-image-preview:large/,
  );
  assert.doesNotMatch(home, /Hellenic|\bOSE\b|aauserver|acrserver|agwserver/i);
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
  assert.equal(website?.alternateName, '모노필드');

  const app = graph.find((entry) => entry['@type'] === 'SoftwareApplication');
  assert.equal(app?.name, 'MonoField');
  assert.equal(app?.operatingSystem, 'Windows');
  assert.equal(app?.offers?.price, '0');
  assert.equal(app?.offers?.priceCurrency, 'USD');
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
});

test('robots and sitemap advertise only absolute canonical URLs', () => {
  assert.match(robots, /^User-agent: \*\r?\nAllow: \/$/m);
  assert.match(robots, new RegExp(`Sitemap: ${siteUrl.replaceAll('.', '\\.')}\/sitemap\\.xml`));
  assert.match(sitemap, new RegExp(`<loc>${siteUrl.replaceAll('.', '\\.')}\/<\/loc>`));
  assert.match(sitemap, new RegExp(`<loc>${siteUrl.replaceAll('.', '\\.')}\/open-source<\/loc>`));
  assert.doesNotMatch(sitemap, /\.html<\/loc>/);
  assert.equal((sitemap.match(/<url>/g) ?? []).length, 2);
});
