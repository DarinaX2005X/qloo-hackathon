import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Reuse the existing deck dependency; never install or change project packages.
const require = createRequire(import.meta.url);
const playwrightPath = process.env.PLAYWRIGHT_PATH || 'C:/Users/user/Desktop/qloo/deck/node_modules/playwright';
const { chromium } = require(playwrightPath);
const playwrightVersion = require(`${playwrightPath}/package.json`).version;
const BASE_URL = process.env.BASE_URL || 'https://homing-taste.vercel.app';
const TIMEOUT = 20_000;
const LOAD_TIMEOUT = 45_000;
// Assistant answers chain several Qloo calls; a cold home lookup alone can take ~45 s.
const AGENT_TIMEOUT = 120_000;
const SCENARIO_COUNT = 21;
// Optional debugging filter, e.g. ONLY=3,17,10. Scenario 3 provides the resolved taste most others reuse.
const ONLY = process.env.ONLY ? process.env.ONLY.split(',').map(s => s.trim()).filter(Boolean) : null;
const reportDir = resolve(dirname(fileURLToPath(import.meta.url)), 'report');
await mkdir(reportDir, { recursive: true });
const started = new Date();
const results = [];
const consoleErrors = [];
const httpErrors = [];
const pendingEvidence = [];
const labels = new WeakMap();
let browser;
let context;
let page;
let active;
let heroTastes;
let chipState;
let sharedState;
let fatalError;

const urlFor = (state, path = '/explore') => {
  const url = new URL(path, BASE_URL);
  if (state) url.searchParams.set('s', Buffer.from(JSON.stringify(state)).toString('base64url'));
  return url.href;
};
function stateOf(p) {
  const s = new URL(p.url()).searchParams.get('s');
  assert.ok(s, 'URL has no ?s= state');
  return JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
}
function track(p, label) {
  labels.set(p, label);
  p.on('response', r => {
    if (r.status() >= 400) httpErrors.push({ time: new Date().toISOString(), scenario: labels.get(p), url: r.url(), status: r.status(), requestBody: r.request().postData() });
  });
  const logError = (kind, text, location = {}) => {
    const entry = { time: new Date().toISOString(), scenario: labels.get(p), pageUrl: p.url(), kind, text, location };
    consoleErrors.push(entry);
    // Capture the first error on each scenario/page, at the moment it occurred.
    if (!consoleErrors.slice(0, -1).some(e => e.scenario === entry.scenario && e.pageUrl === entry.pageUrl)) {
      const file = `console-${consoleErrors.length}.png`;
      pendingEvidence.push(p.screenshot({ path: resolve(reportDir, file), timeout: 5000 }).then(() => { entry.screenshot = file; }).catch(e => { entry.screenshotError = e.message; }));
    }
  };
  p.on('console', m => { if (m.type() === 'error') logError('console.error', m.text(), m.location()); });
  p.on('pageerror', e => logError('pageerror', e.stack || e.message));
  p.setDefaultTimeout(TIMEOUT);
  p.setDefaultNavigationTimeout(TIMEOUT);
  return p;
}
async function newPage(label, viewport) {
  const p = track(await context.newPage(), label);
  if (viewport) await p.setViewportSize(viewport);
  return p;
}
async function poll(fn, description, timeout = TIMEOUT) {
  const begin = performance.now();
  let last;
  do {
    try { const value = await fn(); if (value) return value; } catch (e) { last = e.message; }
    await new Promise(r => setTimeout(r, 150));
  } while (performance.now() - begin < timeout);
  throw new Error(`${description}: not satisfied within ${timeout} ms${last ? `; last observation: ${last}` : ''}`);
}
async function countAtLeast(p, id, min, timeout = LOAD_TIMEOUT) {
  const loc = p.getByTestId(id);
  await poll(async () => {
    const count = await loc.count();
    assert.ok(count >= min, `${id}: expected >= ${min}, observed ${count}`);
    return true;
  }, `${id}: expected >= ${min}`, timeout);
  await loc.first().waitFor({ state: 'visible' });
  return loc.count();
}
async function shot(p, name) {
  const file = `${active.id}-${name}.png`;
  // Let the short panel/tab transitions settle at screenshot review boundaries.
  await p.waitForTimeout(350);
  await p.screenshot({ path: resolve(reportDir, file), fullPage: false, animations: 'disabled', timeout: 10_000 });
  active.screenshots.push(file);
  return file;
}
async function step(name, p, fn) {
  labels.set(p, active.id);
  const begin = performance.now();
  const entry = { name, status: 'PASS' };
  try { entry.details = await fn(); }
  catch (e) {
    entry.status = 'FAIL';
    entry.reason = e.message;
    entry.stack = e.stack;
    try { entry.screenshot = await shot(p, `fail-${active.steps.length + 1}`); } catch (s) { entry.screenshotError = s.message; }
  }
  entry.durationMs = Math.round(performance.now() - begin);
  active.steps.push(entry);
  console.log(`  ${entry.status} ${name} (${(entry.durationMs / 1000).toFixed(2)}s)${entry.reason ? `: ${entry.reason.split('\n')[0]}` : ''}`);
  return entry.status === 'PASS';
}
async function scenario(id, name, fn) {
  if (ONLY && !ONLY.includes(id)) return;
  active = { id, name, status: 'PASS', steps: [], screenshots: [] };
  const begin = performance.now();
  console.log(`\n${id}. ${name}`);
  try { await fn(); }
  catch (e) {
    active.steps.push({ name: 'Scenario setup', status: 'FAIL', reason: e.message, stack: e.stack, durationMs: 0 });
    if (page && !page.isClosed()) try { await shot(page, 'setup-fail'); } catch { /* original error preserved */ }
  }
  if (!active.steps.length || active.steps.some(s => s.status === 'FAIL')) active.status = 'FAIL';
  active.durationMs = Math.round(performance.now() - begin);
  results.push(active);
  console.log(`${active.status} ${id} (${(active.durationMs / 1000).toFixed(2)}s)`);
  await saveReport();
}
async function mapReady(p, timeout = LOAD_TIMEOUT) {
  // The production build does not expose a MapLibre instance. Check real rendered
  // WebGL pixels, not mere canvas existence, without patching/instrumenting the app.
  await p.waitForFunction(() => {
    const canvas = document.querySelector('canvas.maplibregl-canvas');
    if (!canvas || canvas.width < 10 || canvas.height < 10) return false;
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl || gl.isContextLost()) return false;
    const colors = new Set();
    const pixel = new Uint8Array(4);
    for (let y = 1; y < 8; y++) for (let x = 1; x < 8; x++) {
      gl.readPixels(Math.floor(canvas.width * x / 8), Math.floor(canvas.height * y / 8), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      colors.add(Array.from(pixel).join(','));
    }
    return colors.size >= 4;
  }, undefined, { timeout, polling: 150 });
}
const hoodName = p => p.getByTestId('neighborhood-row').first().locator('span.truncate').innerText();
async function openTaste(p) {
  assert.ok(chipState?.l?.length >= 2, 'Dependency failed: scenario 3 did not produce resolved Radiohead/Fleabag URL state');
  await p.goto(urlFor(chipState), { waitUntil: 'domcontentloaded' });
  await countAtLeast(p, 'neighborhood-row', 3);
}
function expected4xx(e) {
  if (e.kind !== 'console.error' || !['9', '11'].includes(e.scenario) || !/Failed to load resource:.*\b4\d\d\b/i.test(e.text)) return false;
  // Only exact resource URLs with an observed intentional edge-case 4xx qualify.
  return httpErrors.some(r => r.scenario === e.scenario && r.status >= 400 && r.status < 500 && r.url === e.location.url && (
    (r.scenario === '9' && new URL(r.url).pathname === '/nope') ||
    (r.scenario === '9' && new URL(r.url).pathname === '/api/search' && new URL(r.url).searchParams.get('q') === 'qwzxv') ||
    (['/api/field', '/api/neighborhoods', '/api/fingerprint'].includes(new URL(r.url).pathname) && (() => { try { return JSON.parse(r.requestBody).city === (r.scenario === '11' ? 'Qwzxplorvillle' : 'Lisbonn'); } catch { return false; } })())
  ));
}
// Screens of the explore shell: rail test id suffix, pathname, and the panel that proves the screen rendered.
const SCREENS = [
  ['map', '/explore', p => p.getByRole('heading', { name: 'Your neighborhoods', exact: true })],
  ['assistant', '/explore/assistant', p => p.getByRole('region', { name: 'Assistant', exact: true })],
  ['home', '/explore/home', p => p.getByTestId('home-screen')],
  ['address', '/explore/address', p => p.getByTestId('address-screen')],
  ['why', '/explore/why', p => p.getByTestId('why-screen')],
  ['trip', '/explore/trip', p => p.getByRole('complementary', { name: 'Plan', exact: true })],
  ['compare', '/explore/compare', p => p.getByRole('complementary', { name: 'Compare', exact: true })],
];
const pathOf = p => new URL(p.url()).pathname;
const isPath = path => u => u.pathname === path;
const apiPath = (r, path) => new URL(r.url()).pathname === path;
const postJson = r => { try { return r.request().postDataJSON(); } catch { return null; } };
// The single MapLibre canvas, tagged with a JS property (survives only if the element itself survives).
const tagMap = (p, tag) => p.evaluate(t => {
  const canvases = document.querySelectorAll('canvas.maplibregl-canvas');
  if (canvases.length !== 1) throw new Error(`expected one map canvas, found ${canvases.length}`);
  canvases[0].__e2eTag = t;
  return true;
}, tag);
const mapTag = p => p.evaluate(() => {
  const canvases = document.querySelectorAll('canvas.maplibregl-canvas');
  return { canvases: canvases.length, tag: canvases[0]?.__e2eTag ?? null, connected: !!canvases[0]?.isConnected };
});
function sameTaste(p, path) {
  const state = stateOf(p);
  assert.equal(state.c, chipState.c, `${path}: ?s= city changed`);
  assert.deepEqual(state.l.map(l => l.id), chipState.l.map(l => l.id), `${path}: ?s= tastes changed`);
  return state;
}
const coordLabel = /^\s*-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+\s*$/;
const md = value => String(value ?? '').replaceAll('|', '\\|').replace(/\r?\n/g, '<br>');
async function saveReport(fatal) {
  const data = { started: started.toISOString(), finished: new Date().toISOString(), baseUrl: BASE_URL, playwrightVersion, browser: browser ? browser.version() : null, desktop: { width: 1440, height: 1000 }, mobile: { width: 390, height: 844 }, results, consoleErrors: consoleErrors.map(e => ({ ...e, expected: expected4xx(e) })), httpErrors, ...((fatal || fatalError) ? { fatal: fatal || fatalError } : {}) };
  await writeFile(resolve(reportDir, 'results.json'), JSON.stringify(data, null, 2));
  const lines = ['# Homing production E2E', '', `URL: ${BASE_URL}`, `Started (UTC): ${data.started}`, `Updated (UTC): ${data.finished}`, `Playwright: ${playwrightVersion}; Chromium: ${data.browser}; desktop 1440×1000; mobile 390×844.`, '', '| # | Scenario | Status | Time | Evidence / exact failure |', '|---|---|---|---|---|'];
  for (const r of results) {
    const failures = r.steps.filter(s => s.status === 'FAIL').map(s => `${md(s.name)}: ${md(s.reason)}${s.screenshot ? ` ([screenshot](${s.screenshot}))` : ''}`);
    const evidence = r.screenshots.map(s => `[${s}](${s})`).join(', ');
    lines.push(`| ${r.id} | ${md(r.name)} | ${r.status} | ${(r.durationMs / 1000).toFixed(2)} s | ${failures.join('<br>') || evidence} |`);
  }
  lines.push('', `Total: ${results.filter(r => r.status === 'PASS').length} PASS, ${results.filter(r => r.status === 'FAIL').length} FAIL. Wall time: ${((Date.now() - started.getTime()) / 1000).toFixed(2)} s.`, '', '## Observations');
  for (const r of results) for (const s of r.steps) lines.push('', `- ${r.id} / ${s.name}: **${s.status}**, ${(s.durationMs / 1000).toFixed(2)} s. ${md(s.reason || JSON.stringify(s.details || {}))}`);
  lines.push('', '## Console', '', `${consoleErrors.filter(e => !expected4xx(e)).length} unexpected console/page errors; ${consoleErrors.filter(expected4xx).length} strictly matched intentional edge-case 4xx errors. Full timestamps, locations, stacks and HTTP failures: [results.json](results.json).`, '', '## Visual review scope', '', 'Screenshots are evidence for a separate pixel review; an automated PASS does not assert human comprehension or user approval. See [visual-review.md](visual-review.md) when present.');
  if (data.fatal) lines.push('', '## Runner failure', '', md(data.fatal));
  await writeFile(resolve(reportDir, 'report.md'), lines.join('\n') + '\n');
}

try {
  browser = await chromium.launch({ headless: process.env.HEADED !== '1' });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US', permissions: ['clipboard-read', 'clipboard-write'] });
  page = await newPage('1');
  await scenario('1', 'Hero live ranking and Berlin city change', async () => {
    let before;
    await step('Hero recommendation appears within 20 seconds', page, async () => {
      const begin = performance.now();
      await page.goto(urlFor(null, '/'), { waitUntil: 'domcontentloaded' });
      const recommendation = page.locator('p').filter({ hasText: 'For this taste, Homing starts you in' });
      await recommendation.waitFor({ state: 'visible', timeout: Math.max(1, TIMEOUT - (performance.now() - begin)) });
      const ms = Math.round(performance.now() - begin);
      assert.ok(ms <= TIMEOUT, `Hero took ${ms} ms > 20000 ms`);
      before = await recommendation.innerText();
      await page.getByTestId('hero-love-input').waitFor();
      heroTastes = await page.getByRole('button', { name: /^Remove / }).evaluateAll(bs => bs.map(b => b.getAttribute('aria-label').replace(/^Remove /, '')));
      assert.ok(heroTastes.length >= 2, 'Expected at least two resolved hero example tastes');
      return { recommendation: before, responseMs: ms, tastes: heroTastes };
    });
    await step('Berlin Enter updates recommendation to Berlin API neighborhoods', page, async () => {
      const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/neighborhoods' && r.ok() && r.request().postDataJSON()?.city === 'Berlin');
      void response.catch(() => {}); // Keep a preceding UI failure from creating an unhandled rejection.
      await page.getByTestId('city-combobox').fill('Berlin');
      await page.getByTestId('city-combobox').press('Enter');
      const body = await (await response).json();
      const names = body.neighborhoods.slice(0, 3).map(n => n.name);
      assert.ok(names.length >= 1, 'Berlin API returned no neighborhoods');
      const recommendation = page.locator('p').filter({ hasText: 'For this taste, Homing starts you in' });
      await poll(async () => { const text = await recommendation.innerText(); return names.every(n => text.includes(n)) && text !== before; }, `Expected Berlin neighborhoods: ${names.join(', ')}`);
      await mapReady(page);
      await shot(page, 'hero-berlin');
      return { city: await page.getByTestId('city-combobox').inputValue(), neighborhoods: names, recommendation: await recommendation.innerText(), renderedMapPixels: true };
    });
  });
  await scenario('2', 'Map my taste preserves tastes and opens ranked explore', async () => {
    await step('Hero → /explore with same tastes and >= 3 neighborhoods', page, async () => {
      assert.ok(heroTastes?.length, 'Hero taste snapshot unavailable');
      const city = await page.getByTestId('city-combobox').inputValue();
      await page.locator('section').filter({ has: page.getByTestId('hero-love-input') }).getByRole('button', { name: 'Map my taste', exact: true }).click();
      await page.waitForURL(u => u.pathname === '/explore');
      const state = stateOf(page);
      assert.equal(state.c, city);
      assert.deepEqual(state.l.map(l => l.q).sort(), [...heroTastes].sort());
      for (const love of state.l) await page.getByRole('button', { name: new RegExp(love.n || love.q, 'i') }).first().waitFor();
      const count = await countAtLeast(page, 'neighborhood-row', 3);
      await mapReady(page);
      await shot(page, 'explore');
      return { city, tastes: state.l.map(l => l.q), neighborhoods: count };
    });
  });
  await scenario('3', 'Comma input creates Radiohead / Music and Fleabag / TV chips', async () => {
    await step('Enter creates exactly two resolved chips from an empty taste', page, async () => {
      await page.goto(urlFor({ c: 'Lisbon', l: [] }), { waitUntil: 'domcontentloaded' });
      const input = page.getByTestId('love-input');
      await input.fill('Radiohead, Fleabag');
      await input.press('Enter');
      await page.getByRole('button', { name: /Radiohead.*Music/ }).waitFor();
      await page.getByRole('button', { name: /Fleabag.*TV/ }).waitFor();
      await poll(() => { const s = stateOf(page); return s.l.length === 2 && s.l.every(l => l.id) && s; }, 'Two resolved tastes in URL');
      chipState = stateOf(page);
      assert.equal(chipState.l.find(l => l.q === 'Radiohead')?.d, 'artist');
      assert.equal(chipState.l.find(l => l.q === 'Fleabag')?.d, 'tv_show');
      await countAtLeast(page, 'neighborhood-row', 3);
      await mapReady(page);
      await shot(page, 'chips');
      return { tastes: chipState.l.map(({ q, d, id }) => ({ q, d, id })) };
    });
  });
  await scenario('4', 'Neighborhood places and first-days plan', async () => {
    await step('First neighborhood opens >= 3 place cards', page, async () => {
      if (!await page.getByTestId('neighborhood-row').count()) await openTaste(page);
      const neighborhood = await hoodName(page);
      await page.getByTestId('neighborhood-row').first().click();
      const places = await countAtLeast(page, 'place-card', 3);
      await shot(page, 'places');
      return { neighborhood, places };
    });
    await step('Plan my first days produces >= 6 stops', page, async () => {
      await page.getByRole('button', { name: 'Plan my first days', exact: true }).click();
      // The plan opens on the Trip screen as a day-by-day timeline.
      await page.waitForURL(u => u.pathname === '/explore/trip');
      const stops = await countAtLeast(page, 'plan-stop', 6);
      await page.getByTestId('plan-stop').first().scrollIntoViewIfNeeded();
      await shot(page, 'plan');
      return { stops };
    });
  });
  await scenario('5', 'Agent less touristy reply and Crowd change within 20 seconds', async () => {
    await step('Agent replies >= 20 characters and range moves above 0.5', page, async () => {
      // The Map screen has a one-line "Ask Homing" bar; it sends the question and opens the Assistant screen.
      if (!await page.getByTestId('ask-input').count()) await openTaste(page);
      const crowd = () => stateOf(page).x ?? 0.35;
      const before = crowd();
      const input = page.getByTestId('ask-input');
      // Only the assistant's answer paragraphs carry this test id; never count the echoed prompt or tool trace.
      const replies = page.getByTestId('assistant-reply');
      const oldCount = await replies.count();
      await input.fill('less touristy');
      const begin = performance.now();
      await input.press('Enter');
      await page.waitForURL(u => u.pathname === '/explore/assistant');
      await poll(async () => await replies.count() > oldCount && (await replies.last().innerText()).trim().length >= 20 && crowd() > 0.5, 'New assistant reply >= 20 chars AND Crowd > 0.5', Math.max(1, TIMEOUT - (performance.now() - begin)));
      const responseMs = Math.round(performance.now() - begin);
      assert.ok(responseMs <= TIMEOUT, `Agent took ${responseMs} ms > 20000 ms`);
      const after = crowd();
      assert.ok(after > before, `Crowd did not increase: ${before} → ${after}`);
      await shot(page, 'agent');
      return { responseMs, before, after, reply: await replies.last().innerText() };
    });
    await step('Quiet cafes near the water adds visible Quiet and Waterfront refinements', page, async () => {
      const input = page.getByTestId('agent-input');
      await input.fill('Find quiet cafes near the water');
      await input.press('Enter');
      await poll(async () => {
        const tags = stateOf(page).r || [];
        // the agent may pick Qloo's "Water" or "Waterfront" tag for "near the water"
        return tags.some(t => /^quiet$/i.test(t[1])) && tags.some(t => /^water(front)?$/i.test(t[1]));
      }, 'Quiet and Waterfront resolved in URL', LOAD_TIMEOUT);
      await shot(page, 'agent-refinements');
      // The must-haves live in the taste panel on the Map screen.
      await page.getByTestId('nav-map').click();
      await page.waitForURL(u => u.pathname === '/explore');
      await page.getByRole('button', { name: 'Remove Quiet', exact: true }).waitFor({ state: 'visible' });
      await page.getByRole('button', { name: /^Remove Water(front)?$/ }).first().waitFor({ state: 'visible' });
      await shot(page, 'agent-refinements-map');
      return { refinements: stateOf(page).r };
    });
  });
  await scenario('6', 'Pair URL with Succession renders You / Them ranking bars', async () => {
    await step('Resolve companion via UI, reopen ?s= with p=[Succession], inspect bars', page, async () => {
      await openTaste(page);
      await page.getByRole('button', { name: /Add someone you/ }).click();
      await page.getByTestId('companion-input').fill('Succession');
      await page.getByTestId('companion-input').press('Enter');
      await poll(() => { const s = stateOf(page); return s.p?.length === 1 && s.p[0].id && s; }, 'Resolved Succession in URL p');
      const state = stateOf(page);
      assert.equal(state.p[0].q, 'Succession');
      assert.equal(state.p[0].d, 'tv_show');
      await page.goto(urlFor(state), { waitUntil: 'domcontentloaded' });
      await countAtLeast(page, 'neighborhood-row', 3);
      const row = page.getByTestId('neighborhood-row').first();
      for (const label of ['You', 'Them']) {
        const text = row.getByText(label, { exact: true });
        await text.waitFor({ state: 'visible' });
        await poll(() => text.evaluate(el => { const fill = el.nextElementSibling?.firstElementChild; return fill && fill.getBoundingClientRect().width > 0 && fill.getBoundingClientRect().height > 0; }), `${label} bar has positive rendered width and height`);
      }
      await mapReady(page);
      await shot(page, 'pair');
      return { companion: state.p, topNeighborhood: await hoodName(page), bars: ['You', 'Them'] };
    });
  });
  await scenario('7', 'Share copies current URL and new tab restores same ranking', async () => {
    await step('Link copied, actual clipboard URL, same neighborhoods and top-1 in new tab', page, async () => {
      if (!await page.getByTestId('neighborhood-row').count()) await openTaste(page);
      const originalNames = await page.getByTestId('neighborhood-row').locator('span.truncate').allInnerTexts();
      const url = page.url();
      await page.getByTestId('share-button').click();
      await page.getByTestId('share-button').filter({ hasText: 'Link copied' }).waitFor();
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      assert.equal(copied, url, 'Clipboard must contain the actual current URL');
      await shot(page, 'copied');
      const restored = await newPage('7');
      try {
        await restored.goto(url, { waitUntil: 'domcontentloaded' });
        await countAtLeast(restored, 'neighborhood-row', 3);
        const names = await restored.getByTestId('neighborhood-row').locator('span.truncate').allInnerTexts();
        assert.equal(names[0], originalNames[0], 'Shared URL top-1 changed');
        assert.deepEqual(names, originalNames, 'Shared URL ordered neighborhoods changed');
        sharedState = stateOf(restored);
        await mapReady(restored);
        await shot(restored, 'restored');
        return { top1: names[0], originalNames, restoredNames: names, clipboardMatches: true };
      } catch (e) { await shot(restored, 'restored-fail'); throw e; }
      finally { await Promise.all(pendingEvidence); await restored.close(); }
    });
  });
  await scenario('8', 'Mobile 390: hero fits and explore tabs work', async () => {
    const mobile = await newPage('8', { width: 390, height: 844 });
    try {
      await step('Hero has no horizontal overflow at width 390', mobile, async () => {
        await mobile.goto(urlFor(null, '/'), { waitUntil: 'domcontentloaded' });
        await mobile.getByTestId('hero-love-input').waitFor();
        await mobile.locator('p').filter({ hasText: 'For this taste, Homing starts you in' }).waitFor();
        await mapReady(mobile);
        const widths = await mobile.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth, hero: document.querySelector('section')?.scrollWidth }));
        assert.equal(widths.viewport, 390);
        assert.ok(widths.document <= 390 && widths.body <= 390 && widths.hero <= 390, `Horizontal overflow: ${JSON.stringify(widths)}`);
        await shot(mobile, 'hero-mobile');
        return widths;
      });
      await step('Explore Your taste / Neighborhoods tabs are visible and switch panels', mobile, async () => {
        assert.ok(chipState, 'Resolved taste state unavailable');
        await mobile.goto(urlFor(sharedState || chipState), { waitUntil: 'domcontentloaded' });
        const taste = mobile.getByRole('radio', { name: 'Your taste', exact: true });
        const neighborhoods = mobile.getByRole('radio', { name: 'Neighborhoods', exact: true });
        await taste.waitFor();
        await neighborhoods.waitFor();
        await neighborhoods.click();
        const count = await countAtLeast(mobile, 'neighborhood-row', 3);
        await mapReady(mobile);
        await shot(mobile, 'neighborhoods-mobile');
        await taste.click();
        await mobile.getByTestId('love-input').waitFor({ state: 'visible' });
        assert.equal(await taste.getAttribute('aria-checked'), 'true');
        await shot(mobile, 'taste-mobile');
        return { tabs: ['Your taste', 'Neighborhoods'], neighborhoods: count };
      });
    } finally { await Promise.all(pendingEvidence); await mobile.close(); }
  });
  await scenario('9', 'Edge cases: unknown taste, Lisbonn typo, HTTP 404', async () => {
    await step('qwzxv gives Not in the taste graph; app stays interactive', page, async () => {
      await openTaste(page);
      await page.getByTestId('love-input').fill('qwzxv');
      await page.getByTestId('love-input').press('Enter');
      const chip = page.getByRole('button', { name: /qwzxv.*Not in the taste graph/ });
      await chip.waitFor();
      await chip.click();
      await page.getByRole('dialog', { name: 'Options for qwzxv' }).waitFor();
      await page.keyboard.press('Escape');
      await countAtLeast(page, 'neighborhood-row', 3);
      assert.equal(await page.getByTestId('love-input').isEnabled(), true);
      await shot(page, 'unknown');
      return { chip: await chip.innerText(), existingResultsRetained: true, chipDialogWorks: true };
    });
    await step('Lisbonn resolves or shows a useful visible error without blank screen', page, async () => {
      const isTypoCity = (c) => typeof c === 'string' && c !== 'Lisbon' && /^lisbonn?(,|$)/i.test(c.trim());
      await openTaste(page);
      const fieldPromise = page.waitForResponse(r => new URL(r.url()).pathname === '/api/field' && isTypoCity(r.request().postDataJSON()?.city), { timeout: LOAD_TIMEOUT });
      void fieldPromise.catch(() => {});
      const responsePromise = page.waitForResponse(r => new URL(r.url()).pathname === '/api/neighborhoods' && isTypoCity(r.request().postDataJSON()?.city), { timeout: LOAD_TIMEOUT });
      void responsePromise.catch(() => {});
      await page.getByTestId('city-combobox').fill('Lisbonn');
      await page.getByTestId('city-combobox').press('Enter');
      // the picker either keeps the typo or resolves it to its best match ("Lisbon, Portugal"); both must answer
      await poll(() => isTypoCity(stateOf(page).c), 'URL city committed to Lisbonn or its best match');
      // Wait for a response for the misspelled city so old Lisbon rows cannot pass.
      const fieldResponse = await fieldPromise;
      const response = fieldResponse.ok() ? await responsePromise : fieldResponse;
      await response.finished();
      const body = await response.json();
      let outcome;
      await poll(async () => {
        const names = body.neighborhoods?.map(n => n.name) || [];
        if (response.ok() && names.length && (await page.getByTestId('neighborhood-row').locator('span.truncate').allInnerTexts()).join('|') === names.join('|')) { outcome = { type: 'results', neighborhoods: names }; return true; }
        const note = page.locator('p').filter({ hasText: /couldn.t|could not|not find|not found|try|unavailable|offline|slow|no named neighborhoods|no .*data|city.*(recogn|locat|support)|larger city/i });
        for (const item of await note.all()) if (await item.isVisible()) { outcome = { type: 'visible-feedback', text: await item.innerText() }; return true; }
        return false;
      }, 'Results or understandable error for Lisbonn', LOAD_TIMEOUT);
      assert.equal(await page.getByTestId('city-combobox').isVisible(), true);
      assert.equal(await page.getByTestId('love-input').isEnabled(), true);
      assert.ok((await page.locator('main').boundingBox())?.height > 100, 'Main application is blank/collapsed');
      await shot(page, 'typo-city');
      return { city: stateOf(page).c, httpStatus: response.status(), outcome };
    });
    await step('/nope is HTTP 404 with the custom street-not-on-map page', page, async () => {
      const response = await page.goto(urlFor(null, '/nope'), { waitUntil: 'domcontentloaded' });
      assert.equal(response.status(), 404, '/nope must return HTTP 404');
      const heading = page.getByRole('heading', { name: "This street isn't on the map", exact: true });
      await heading.waitFor();
      await page.getByRole('link', { name: 'Map my taste', exact: true }).waitFor();
      await shot(page, '404');
      return { status: response.status(), heading: await heading.innerText() };
    });
  });
  await scenario('11', 'World city Tokyo, unknown-city clearing and Lisbon recovery', async () => {
    const ready = await step('Tokyo compact state renders >= 3 neighborhoods and real WebGL pixels', page, async () => {
      assert.ok(chipState?.l?.length >= 2, 'Resolved taste state unavailable');
      const state = { c: 'Tokyo, Japan', l: chipState.l };
      await page.goto(urlFor(state), { waitUntil: 'domcontentloaded' });
      const count = await countAtLeast(page, 'neighborhood-row', 3);
      assert.equal(stateOf(page).c, state.c);
      assert.deepEqual(stateOf(page).l, state.l);
      await mapReady(page);
      await shot(page, 'tokyo');
      return { city: stateOf(page).c, neighborhoods: count, names: await page.getByTestId('neighborhood-row').locator('span.truncate').allInnerTexts(), renderedMapPixels: true };
    });
    await step('Unknown city shows could not find feedback and removes Tokyo ranking', page, async () => {
      assert.ok(ready, 'Dependency failed: Tokyo did not load');
      const city = page.getByTestId('city-combobox');
      await city.fill('Qwzxplorvillle');
      // Clicking away commits the typed value without racing asynchronous options.
      await page.getByRole('heading', { name: 'Your neighborhoods', exact: true }).click();
      await poll(() => stateOf(page).c === 'Qwzxplorvillle', 'Unknown city committed');
      const error = page.getByText(/We couldn.t find.*Qwzxplorvillle/i);
      await error.waitFor({ state: 'visible', timeout: LOAD_TIMEOUT });
      await poll(async () => await page.getByTestId('neighborhood-row').count() === 0 && await page.locator('.maplibregl-marker').count() === 0, 'Previous city rows and map markers cleared');
      await shot(page, 'unknown-city-cleared');
      return { city: stateOf(page).c, error: await error.innerText(), neighborhoods: 0, mapMarkers: 0, terrainEvidence: 'Review unknown-city-cleared screenshot for absent Tokyo terrain; basemap may remain.' };
    });
    await step('Switching back to Lisbon restores neighborhoods and map', page, async () => {
      const city = page.getByTestId('city-combobox');
      await city.fill('Lisbon');
      await city.press('Enter');
      await poll(() => /^Lisbon(?:,|$)/.test(stateOf(page).c), 'Lisbon committed');
      const count = await countAtLeast(page, 'neighborhood-row', 3);
      await mapReady(page);
      await shot(page, 'lisbon-recovered');
      return { city: stateOf(page).c, neighborhoods: count };
    });
  });
  await scenario('12', 'Landing typed city commits its best match on Map my taste', async () => {
    await step('Reykjav without Enter opens explore with Reykjavik URL city', page, async () => {
      await page.goto(urlFor(null, '/'), { waitUntil: 'domcontentloaded' });
      const hero = page.locator('section').filter({ has: page.getByTestId('hero-love-input') });
      const cta = hero.getByRole('button', { name: 'Map my taste', exact: true });
      await poll(() => cta.isEnabled(), 'Resolved hero tastes enable CTA', LOAD_TIMEOUT);
      const lookupPromise = page.waitForResponse(r => new URL(r.url()).pathname === '/api/localities' && new URL(r.url()).searchParams.get('q') === 'Reykjav', { timeout: LOAD_TIMEOUT });
      void lookupPromise.catch(() => {});
      await hero.getByTestId('city-combobox').fill('Reykjav');
      // Observe the real lookup, including failures, then exercise the CTA anyway.
      // Never select an option or press Enter to make the city commit succeed.
      const response = await lookupPromise;
      const lookup = { status: response.status(), body: await response.json() };
      if (lookup.body.results?.length) await page.getByRole('option').filter({ hasText: /^Reykjav[ií]k(?![a-z])/ }).first().waitFor({ state: 'visible', timeout: LOAD_TIMEOUT });
      await shot(page, 'typed-reykjav');
      await cta.click();
      await page.waitForURL(u => u.pathname === '/explore');
      const state = stateOf(page);
      await page.getByTestId('city-combobox').waitFor();
      await shot(page, 'reykjavik-explore');
      assert.match(state.c, /^Reykjavik/i, `CTA must retain the typed city best match; observed city=${state.c}; locality lookup=${JSON.stringify(lookup)}`);
      assert.ok(state.l.filter(l => l.id).length >= 2, 'CTA lost resolved tastes');
      return { typed: 'Reykjav', city: state.c, tastes: state.l.map(l => l.q), lookup };
    });
  });
  await scenario('13', 'Genre love resolves to an artist with for jazz subtitle', async () => {
    await step('Adding jazz creates a resolved Music, for jazz chip', page, async () => {
      await openTaste(page);
      await page.getByTestId('love-input').fill('jazz');
      await page.getByTestId('love-input').press('Enter');
      const chip = page.getByRole('button', { name: /Music, for jazz/i });
      const love = await poll(async () => {
        const resolved = stateOf(page).l.find(l => l.q === 'jazz' && l.id);
        assert.equal(resolved?.d, 'artist', `Expected jazz artist stand-in; observed ${JSON.stringify(resolved || null)}`);
        return await chip.isVisible() && resolved;
      }, 'Resolved jazz artist in URL and visible Music, for jazz chip', LOAD_TIMEOUT);
      await shot(page, 'genre-love');
      return { chip: await chip.innerText(), love };
    });
  });
  await scenario('14', 'Must-haves, budget, packed plan, swap and Saved drawer flow', async () => {
    let beforeCount;
    let firstStop;
    await step('Cozy resolves as a refinement and Budget $$ persists', page, async () => {
      await openTaste(page);
      const refinedResponse = page.waitForResponse(r => new URL(r.url()).pathname === '/api/neighborhoods' && r.request().postDataJSON()?.refinements?.some(t => /^cozy$/i.test(t.name)), { timeout: LOAD_TIMEOUT });
      void refinedResponse.catch(() => {});
      await page.getByRole('button', { name: 'Cozy', exact: true }).click();
      await page.getByRole('button', { name: 'Remove Cozy', exact: true }).waitFor({ state: 'visible', timeout: LOAD_TIMEOUT });
      await poll(() => stateOf(page).r?.some(t => t[0] && /^cozy$/i.test(t[1])), 'Resolved Cozy tag in URL');
      const budget = page.getByRole('radio', { name: '$$', exact: true });
      await budget.click();
      await poll(async () => stateOf(page).b === 2 && await budget.getAttribute('aria-checked') === 'true', 'Budget $$ selected and in URL');
      const response = await refinedResponse;
      assert.ok(response.ok(), `Cozy ranking HTTP ${response.status()}`);
      const names = (await response.json()).neighborhoods.map(n => n.name);
      await poll(async () => (await page.getByTestId('neighborhood-row').locator('span.truncate').allInnerTexts()).join('|') === names.join('|'), 'Rendered ranking matches Cozy response', LOAD_TIMEOUT);
      await shot(page, 'trip-controls');
      return { refinements: stateOf(page).r, budget: stateOf(page).b };
    });
    const planned = await step('First neighborhood produces a plan; Packed stop count does not decrease', page, async () => {
      await countAtLeast(page, 'neighborhood-row', 3);
      await page.getByTestId('neighborhood-row').first().click();
      await countAtLeast(page, 'place-card', 1);
      await page.getByRole('button', { name: 'Plan my first days', exact: true }).click();
      await page.waitForURL(u => u.pathname === '/explore/trip');
      beforeCount = await countAtLeast(page, 'plan-stop', 1);
      const packedResponse = page.waitForResponse(r => new URL(r.url()).pathname === '/api/plan' && r.request().postDataJSON()?.pace === 'packed', { timeout: LOAD_TIMEOUT });
      void packedResponse.catch(() => {});
      await page.getByRole('radio', { name: 'Packed', exact: true }).click();
      const response = await packedResponse;
      assert.ok(response.ok(), `Packed plan HTTP ${response.status()}`);
      await response.finished();
      await poll(() => stateOf(page).pc === 'packed', 'Packed pace in URL');
      const afterCount = await countAtLeast(page, 'plan-stop', beforeCount);
      firstStop = await page.getByTestId('plan-stop').first().locator('p').first().innerText();
      await page.getByTestId('plan-stop').first().scrollIntoViewIfNeeded();
      await shot(page, 'packed-plan');
      return { beforeCount, afterCount, firstStop };
    });
    await step('Swap first stop changes its name and excludes the original', page, async () => {
      assert.ok(planned, 'Dependency failed: Packed plan unavailable');
      const stop = page.getByTestId('plan-stop').first();
      await stop.hover();
      await stop.getByRole('button', { name: /^Swap / }).click();
      const changed = await poll(async () => {
        const names = await page.getByTestId('plan-stop').locator('p.truncate').allInnerTexts();
        return names.length && names[0] !== firstStop && !names.includes(firstStop) && names;
      }, `Swapped plan no longer contains ${firstStop}`, LOAD_TIMEOUT);
      await page.getByTestId('plan-stop').first().scrollIntoViewIfNeeded();
      await shot(page, 'swapped-stop');
      return { before: firstStop, after: changed[0], stops: changed.length };
    });
    await step('Place drawer Save is reflected in the Trip screen shortlist', page, async () => {
      // Back to the Map screen, where the opened neighborhood still lists its places.
      await page.getByTestId('nav-map').click();
      await page.waitForURL(u => u.pathname === '/explore');
      const card = page.getByTestId('place-card').first();
      await card.waitFor();
      const name = await card.getByRole('heading').innerText();
      await card.getByRole('button', { name: `Open ${name}`, exact: true }).click();
      await page.getByRole('heading', { name, exact: true }).waitFor();
      await page.getByRole('button', { name: /^(Add to plan|In your plan)$/, exact: true }).waitFor();
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await poll(async () => await page.getByRole('button', { name: 'Saved', exact: true }).getAttribute('aria-pressed') === 'true', 'Drawer Save becomes Saved');
      await shot(page, 'saved-drawer');
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await page.getByRole('button', { name: 'All neighborhoods', exact: true }).click();
      await page.getByRole('heading', { name: 'Your neighborhoods', exact: true }).waitFor();
      // The shortlist lives on the Trip screen.
      await page.getByTestId('nav-trip').click();
      await page.waitForURL(u => u.pathname === '/explore/trip');
      await page.getByTestId('place-card').getByRole('heading', { name, exact: true }).waitFor();
      const planSaved = page.getByRole('button', { name: /^Plan around these \d+$/ });
      await planSaved.waitFor();
      await shot(page, 'saved-tab');
      return { savedPlace: name, action: await planSaved.innerText() };
    });
  });
  await scenario('15', 'Compare cities relative index and open another city map', async () => {
    await step('Lisbon + Berlin + a third city compare; first result is 100 and map action switches city', page, async () => {
      await openTaste(page);
      const originalCity = stateOf(page).c;
      // Compare is its own screen; the cities are its "Compare cities" section.
      await page.getByTestId('nav-compare').click();
      await page.waitForURL(u => u.pathname === '/explore/compare');
      const dialog = page.getByRole('region', { name: 'Compare cities', exact: true });
      await dialog.waitFor();
      for (const name of ['Lisbon', 'Berlin']) await dialog.getByRole('button', { name: `Remove ${name}`, exact: true }).waitFor();
      // Exercise adding a city even though a third default is provided.
      const extra = dialog.getByRole('button', { name: 'Remove Mexico City', exact: true });
      if (await extra.count()) await extra.click();
      await dialog.getByTestId('city-combobox').fill('Tokyo');
      await dialog.getByTestId('city-combobox').press('Enter');
      await dialog.getByRole('button', { name: /^Remove Tokyo(?:,|$)/ }).waitFor();
      const listed = await dialog.getByRole('button', { name: /^Remove / }).allTextContents();
      assert.ok(listed.length >= 3, 'Expected at least three listed cities');
      await dialog.getByRole('button', { name: 'Compare', exact: true }).click();
      const cards = dialog.locator('ol > li');
      await poll(async () => await cards.count() >= 2 && await dialog.getByRole('button', { name: /^Open the map of / }).count() >= 2, 'At least two successful city result cards', LOAD_TIMEOUT);
      await cards.first().getByText('100', { exact: true }).waitFor();
      const names = await cards.allInnerTexts();
      await shot(page, 'city-comparison');
      const actions = dialog.getByRole('button', { name: /^Open the map of / });
      let target;
      for (const action of await actions.all()) {
        const name = (await action.innerText()).replace(/^Open the map of /, '').trim();
        if (name !== originalCity.split(',')[0]) { target = name; await action.click(); break; }
      }
      assert.ok(target, 'No successful result for a different city');
      await page.waitForURL(u => u.pathname === '/explore');
      await poll(() => stateOf(page).c.split(',')[0] === target, `City URL switches to ${target}`);
      await countAtLeast(page, 'neighborhood-row', 3);
      await mapReady(page);
      await shot(page, 'compared-city-map');
      return { results: names, originalCity, city: stateOf(page).c, topIndex: 100 };
    });
  });
  await scenario('16', 'Browser Back restores explore ranking after opening a neighborhood', async () => {
    await step('Neighborhood navigation adds history; goBack returns ranking at /explore', page, async () => {
      await openTaste(page);
      const beforeNames = await page.getByTestId('neighborhood-row').locator('span.truncate').allInnerTexts();
      await page.getByTestId('neighborhood-row').first().click();
      await page.getByRole('button', { name: 'All neighborhoods', exact: true }).waitFor();
      await poll(() => stateOf(page).nb, 'Selected neighborhood in URL');
      await countAtLeast(page, 'place-card', 1);
      await shot(page, 'before-browser-back');
      await page.goBack();
      await page.getByRole('heading', { name: 'Your neighborhoods', exact: true }).waitFor();
      const count = await countAtLeast(page, 'neighborhood-row', 3);
      assert.equal(new URL(page.url()).pathname, '/explore');
      assert.ok(!stateOf(page).nb, 'Back retained selected neighborhood');
      assert.deepEqual(await page.getByTestId('neighborhood-row').locator('span.truncate').allInnerTexts(), beforeNames);
      await shot(page, 'back-to-ranking');
      return { path: new URL(page.url()).pathname, neighborhoods: count, sameRanking: true };
    });
  });
  await scenario('17', 'Screens rail keeps ?s= and one map; Back between screens; mobile tab bar and More', async () => {
    const tag = `e2e-${Date.now()}`;
    const visited = [];
    const railed = await step('Rail visits all seven screens with ?s= kept and the same map canvas', page, async () => {
      await openTaste(page);
      await mapReady(page);
      await tagMap(page, tag);
      // Start on Map, visit the other six, then return to Map, all through the rail.
      for (const [key, path, panel] of [...SCREENS.slice(1), SCREENS[0]]) {
        const link = page.getByTestId(`nav-${key}`);
        const begin = performance.now();
        await link.click();
        await page.waitForURL(isPath(path));
        await panel(page).waitFor({ state: 'visible', timeout: LOAD_TIMEOUT });
        sameTaste(page, path);
        await poll(async () => await link.getAttribute('aria-current') === 'page', `nav-${key} marked as current`);
        const m = await mapTag(page);
        assert.deepEqual(m, { canvases: 1, tag, connected: true }, `${path}: map canvas was replaced or duplicated (${JSON.stringify(m)})`);
        visited.push({ path, ms: Math.round(performance.now() - begin) });
        await shot(page, `screen-${key}`);
      }
      await mapReady(page);
      return { visited, mapCanvasTag: tag, canvases: 1 };
    });
    await step('Browser Back returns to Compare, then Trip, keeping ?s= and the map', page, async () => {
      assert.ok(railed, 'Dependency failed: rail navigation did not complete');
      const back = [];
      for (const [key, path, panel] of [SCREENS[6], SCREENS[5]]) {
        await page.goBack();
        await page.waitForURL(isPath(path));
        await panel(page).waitFor({ state: 'visible' });
        sameTaste(page, path);
        await poll(async () => await page.getByTestId(`nav-${key}`).getAttribute('aria-current') === 'page', `nav-${key} marked as current after Back`);
        const m = await mapTag(page);
        assert.deepEqual(m, { canvases: 1, tag, connected: true }, `Back to ${path}: map canvas was replaced (${JSON.stringify(m)})`);
        back.push(path);
      }
      await shot(page, 'back-to-trip');
      return { back, mapCanvasTag: tag };
    });
    const mobile = await newPage('17', { width: 390, height: 844 });
    try {
      await step('Mobile 390×844: bottom tab bar visible; More opens Why, Trip and Compare', mobile, async () => {
        await mobile.goto(urlFor(chipState), { waitUntil: 'domcontentloaded' });
        // Before the media query settles the desktop rail (also "Screens") can render for a frame; anchor on a tab.
        await mobile.getByTestId('tab-map').waitFor({ state: 'visible' });
        const bar = mobile.getByRole('navigation', { name: 'Screens', exact: true }).filter({ has: mobile.getByTestId('tab-map') });
        await bar.waitFor({ state: 'visible' });
        const box = await bar.boundingBox();
        assert.ok(box && Math.abs(box.y + box.height - 844) <= 2 && box.width >= 388, `Tab bar is not docked at the bottom: ${JSON.stringify(box)}`);
        for (const key of ['map', 'assistant', 'home', 'address']) await mobile.getByTestId(`tab-${key}`).waitFor({ state: 'visible' });
        assert.equal(await mobile.getByTestId('nav-map').count(), 0, 'Desktop rail rendered on a phone');
        const more = mobile.getByRole('button', { name: 'More screens', exact: true });
        const opened = [];
        for (const [title, path, label] of [['What decides', '/explore/why', 'Why'], ['Trip', '/explore/trip', 'Trip'], ['Compare', '/explore/compare', 'Compare']]) {
          await more.click();
          const sheet = mobile.getByRole('dialog', { name: 'More screens', exact: true });
          await sheet.waitFor({ state: 'visible' });
          if (!opened.length) await shot(mobile, 'more-sheet');
          await sheet.getByRole('link', { name: new RegExp(`^${title}`) }).click();
          await mobile.waitForURL(isPath(path));
          await sheet.waitFor({ state: 'hidden' });
          sameTaste(mobile, path);
          await poll(async () => (await more.innerText()).trim() === label, `More tab shows the active hidden screen "${label}"`);
          opened.push(path);
        }
        const widths = await mobile.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
        assert.ok(widths.document <= widths.viewport, `Horizontal overflow on mobile Compare: ${JSON.stringify(widths)}`);
        await shot(mobile, 'mobile-compare');
        return { tabBar: box, tabs: ['Map', 'Assistant', 'Home', 'Address', 'More'], opened, widths };
      });
    } finally { await Promise.all(pendingEvidence); await mobile.close(); }
  });
  await scenario('18', 'Feels like home: Kreuzberg, Berlin printed over Lisbon', async () => {
    await step('Berlin + Kreuzberg gives a match with similarity and a twin pair or shared tags', page, async () => {
      assert.ok(chipState?.l?.length >= 2, 'Resolved taste state unavailable');
      await page.goto(urlFor(chipState, '/explore/home'), { waitUntil: 'domcontentloaded' });
      const panel = page.getByTestId('home-screen');
      await panel.waitFor({ state: 'visible' });
      const city = panel.getByTestId('city-combobox');
      await city.click();
      await city.fill('Berlin');
      // Choose the option explicitly: Enter on a value equal to the current one commits the highlighted popular city instead.
      await page.getByRole('option').filter({ hasText: /^Berlin/ }).first().click();
      await poll(async () => /^Berlin(?:,|$)/.test(await city.inputValue()), 'Old city set to Berlin');
      await panel.getByTestId('home-neighborhood').fill('Kreuzberg');
      const homeResponse = page.waitForResponse(r => apiPath(r, '/api/home') && /^kreuzberg$/i.test(postJson(r)?.source?.neighborhood ?? ''), { timeout: LOAD_TIMEOUT + 15_000 });
      void homeResponse.catch(() => {});
      const begin = performance.now();
      await panel.getByTestId('home-submit').click();
      const response = await homeResponse;
      assert.ok(response.ok(), `/api/home HTTP ${response.status()}`);
      const body = await response.json();
      const requestCity = postJson(response)?.source?.city;
      assert.match(requestCity, /^Berlin/, `Request old city was ${requestCity}`);
      const matches = panel.locator('ol > li');
      await poll(async () => await matches.count() >= 1, 'At least one rendered match', LOAD_TIMEOUT);
      let evidence;
      await poll(async () => {
        for (const li of await matches.all()) {
          const text = await li.innerText();
          const sim = text.match(/(\d{1,3})\s*%\s*alike/);
          const twins = await li.getByText('at home', { exact: true }).count();
          const shares = await li.getByText('Shares', { exact: true }).count();
          if (sim && (twins || shares)) { evidence = { name: text.split('\n').map(s => s.trim()).filter(Boolean)[1], similarity: Number(sim[1]), twinPairs: twins, sharedTags: !!shares }; return true; }
        }
        return false;
      }, 'A match with "% alike" and a twin pair (old place → new place) or Shares tags', LOAD_TIMEOUT);
      assert.ok(evidence.similarity > 0 && evidence.similarity <= 100, `Similarity out of range: ${evidence.similarity}`);
      const legend = page.getByText(/The terrain shows\s+Kreuzberg, Berlin\s+printed over Lisbon/);
      await legend.waitFor({ state: 'visible' });
      const ms = Math.round(performance.now() - begin);
      await mapReady(page);
      await shot(page, 'home-kreuzberg');
      return { responseMs: ms, apiMatches: body.matches.length, renderedMatches: await matches.count(), top: evidence, legend: await legend.innerText() };
    });
  });
  await scenario('19', 'Check an address: Rua da Rosa 120, then a map click', async () => {
    let first;
    const checked = await step('Rua da Rosa 120 shows Better than N%, its neighborhood and walk places with minutes', page, async () => {
      assert.ok(chipState?.l?.length >= 2, 'Resolved taste state unavailable');
      await page.goto(urlFor(chipState, '/explore/address'), { waitUntil: 'domcontentloaded' });
      const panel = page.getByTestId('address-screen');
      await panel.waitFor({ state: 'visible' });
      await page.getByTestId('address-input').fill('Rua da Rosa 120');
      const spotResponse = page.waitForResponse(r => apiPath(r, '/api/spot') && postJson(r)?.query === 'Rua da Rosa 120', { timeout: LOAD_TIMEOUT });
      void spotResponse.catch(() => {});
      await page.getByTestId('address-submit').click();
      const response = await spotResponse;
      assert.ok(response.ok(), `/api/spot HTTP ${response.status()}`);
      const percentile = page.getByTestId('spot-percentile');
      await percentile.waitFor({ state: 'visible', timeout: LOAD_TIMEOUT });
      const n = Number((await percentile.innerText()).match(/Better than\s*(\d+)\s*%/)?.[1]);
      assert.ok(n > 0 && n <= 100, `Better than N% out of range: ${await percentile.innerText()}`);
      const hood = panel.getByText(/^In .+, ranked #\d+ for you$/);
      await hood.waitFor({ state: 'visible' });
      const hoodName = (await hood.innerText()).match(/^In (.+), ranked #\d+/)[1].trim();
      assert.ok(hoodName.length > 1, 'Empty neighborhood name');
      const walk = panel.locator('a[href]').filter({ hasText: /\d+\s*min/ });
      await poll(async () => await walk.count() >= 1, 'At least one walk place with minutes');
      const walkFirst = (await walk.first().innerText()).replace(/\s+/g, ' ').trim();
      const label = await percentile.locator('xpath=preceding-sibling::p[1]').innerText();
      first = { label, percentile: n };
      await mapReady(page);
      await shot(page, 'address-rua-da-rosa');
      return { label, percentile: n, neighborhood: hoodName, walkPlaces: await walk.count(), firstWalk: walkFirst };
    });
    await step('A click on the map checks that point; its label is not raw coordinates', page, async () => {
      assert.ok(checked, 'Dependency failed: typed address check did not complete');
      // Let the camera finish flying to the pin before clicking, so the click lands where it was aimed.
      let last;
      await poll(async () => {
        const box = await page.locator('.hm-pin').first().boundingBox();
        const same = box && last && Math.abs(box.x - last.x) < 1 && Math.abs(box.y - last.y) < 1;
        last = box;
        await page.waitForTimeout(400);
        return same;
      }, 'Map camera settled on the pin', LOAD_TIMEOUT);
      // A bare map point (not a neighborhood plate, pin or panel) about 180 px from the pin.
      const target = await page.evaluate(() => {
        const canvas = document.querySelector('canvas.maplibregl-canvas');
        const r = canvas.getBoundingClientRect();
        const panel = document.querySelector('[data-testid="address-screen"]').getBoundingClientRect();
        const pin = document.querySelector('.hm-pin')?.getBoundingClientRect();
        const px = pin ? pin.left + pin.width / 2 : (panel.right + r.right) / 2;
        const py = pin ? pin.top + pin.height / 2 : (r.top + r.bottom) / 2;
        let best;
        for (let y = r.top + 120; y < r.bottom - 60; y += 17) for (let x = Math.max(r.left, panel.right) + 40; x < r.right - 40; x += 19) {
          if (document.elementFromPoint(x, y) !== canvas) continue;
          const score = Math.abs(Math.hypot(x - px, y - py) - 180);
          if (!best || score < best.score) best = { x: Math.round(x), y: Math.round(y), score };
        }
        return best;
      });
      assert.ok(target, 'No bare map point available to click');
      const spotResponse = page.waitForResponse(r => apiPath(r, '/api/spot') && Array.isArray(postJson(r)?.point) && !postJson(r)?.query, { timeout: LOAD_TIMEOUT });
      void spotResponse.catch(() => {});
      await page.mouse.click(target.x, target.y);
      const response = await spotResponse;
      assert.ok(response.ok(), `/api/spot (point) HTTP ${response.status()}`);
      const body = await response.json();
      const percentile = page.getByTestId('spot-percentile');
      const labelEl = percentile.locator('xpath=preceding-sibling::p[1]');
      const label = await poll(async () => { const t = (await labelEl.innerText()).trim(); return t && t !== first.label && t; }, `Result label changes from "${first.label}"`, LOAD_TIMEOUT);
      assert.ok(!coordLabel.test(label), `Clicked point label is raw coordinates: "${label}" (API label "${body.label}")`);
      const n = Number((await percentile.innerText()).match(/Better than\s*(\d+)\s*%/)?.[1]);
      assert.ok(n > 0 && n <= 100, `Better than N% out of range after the click: ${await percentile.innerText()}`);
      // Move the pointer off the map so the hex hover card does not cover the pin label in the evidence.
      await page.mouse.move(300, 120);
      await page.waitForTimeout(600);
      await shot(page, 'address-map-click');
      return { clicked: target, point: postJson(response).point, label, apiLabel: body.label, percentile: n, before: first };
    });
  });
  await scenario('20', 'What decides: summary and a row per love for the first neighborhood', async () => {
    await step('Why shows the summary and, for #1, every love with a rank or Out of the top 8', page, async () => {
      assert.ok(chipState?.l?.length >= 2, 'Resolved taste state unavailable');
      const decides = page.waitForResponse(r => apiPath(r, '/api/decides') && r.ok(), { timeout: LOAD_TIMEOUT + 15_000 });
      void decides.catch(() => {});
      await page.goto(urlFor(chipState, '/explore/why'), { waitUntil: 'domcontentloaded' });
      const panel = page.getByTestId('why-screen');
      await panel.waitFor({ state: 'visible' });
      const body = await (await decides).json();
      assert.ok(body.summary?.trim(), 'Decides API returned no summary');
      const summary = panel.getByText(body.summary.trim(), { exact: true });
      await summary.waitFor({ state: 'visible', timeout: LOAD_TIMEOUT });
      const loves = stateOf(page).l.filter(l => l.id && (l.w ?? 1) > 0);
      const firstHood = panel.locator('section').first();
      await firstHood.waitFor({ state: 'visible' });
      const name = (await firstHood.getByRole('button').first().innerText()).replace(/\s+/g, ' ').replace(/^\d+\s*|\s*without each love$/g, '').trim();
      const rows = firstHood.locator('li');
      await poll(async () => await rows.count() === loves.length, `First neighborhood has one row per love (${loves.length})`);
      const texts = (await rows.allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());
      for (const t of texts) assert.match(t, /#\d+|Out of the top 8/, `Row without a rank: "${t}"`);
      for (const love of loves) assert.ok(texts.some(t => t.toLowerCase().includes((love.n || love.q).toLowerCase())), `No row for ${love.n || love.q}: ${JSON.stringify(texts)}`);
      await mapReady(page);
      await shot(page, 'why');
      return { summary: body.summary, firstNeighborhood: name, rows: texts, robust: body.robust, pivotal: body.pivotal };
    });
  });
  await scenario('21', 'Assistant home card opens on the map without a new home request', async () => {
    let card;
    const answered = await step('"I used to live in Kreuzberg, Berlin" streams text and a home card', page, async () => {
      assert.ok(chipState?.l?.length >= 2, 'Resolved taste state unavailable');
      await page.goto(urlFor(chipState, '/explore/assistant'), { waitUntil: 'domcontentloaded' });
      const input = page.getByTestId('agent-input');
      await input.waitFor({ state: 'visible' });
      const agentResponse = page.waitForResponse(r => apiPath(r, '/api/agent') && r.request().method() === 'POST', { timeout: AGENT_TIMEOUT });
      void agentResponse.catch(() => {});
      await input.fill('I used to live in Kreuzberg, Berlin');
      const begin = performance.now();
      await input.press('Enter');
      const response = await agentResponse;
      assert.ok(response.ok(), `/api/agent HTTP ${response.status()}`);
      const contentType = response.headers()['content-type'] || '';
      assert.match(contentType, /event-stream|ndjson|text\/plain/, `Agent response is not a stream: ${contentType}`);
      const turn = page.getByTestId('assistant-turn').last();
      const reply = turn.getByTestId('assistant-reply');
      const lengths = [];
      let firstTextMs;
      let textWhileStreaming = false;
      await poll(async () => {
        const done = await page.getByRole('button', { name: 'Send', exact: true }).count() > 0;
        if (await reply.count()) {
          const len = (await reply.innerText()).trim().length;
          if (len && firstTextMs === undefined) firstTextMs = Math.round(performance.now() - begin);
          if (len && lengths[lengths.length - 1] !== len) lengths.push(len);
          if (len && !done) textWhileStreaming = true;
        }
        return done && lengths.length && lengths[lengths.length - 1] >= 20;
      }, 'Streamed reply of >= 20 characters and the answer finished', AGENT_TIMEOUT);
      card = turn.locator('div').filter({ has: page.getByText(/Kreuzberg, Berlin in /) }).filter({ has: page.getByRole('button', { name: /Open on the map/ }) }).last();
      await card.waitFor({ state: 'visible' });
      const cardText = (await card.innerText()).replace(/\s+/g, ' ').trim();
      assert.match(cardText, /\d+%/, `Home card has no similarity: ${cardText}`);
      await shot(page, 'assistant-home-card');
      return { contentType, firstTextMs, textWhileStreaming, totalMs: Math.round(performance.now() - begin), streamedLengths: lengths, reply: await reply.innerText(), card: cardText };
    });
    await step('Open on the map lands on /explore/home with the result and no /api/home request', page, async () => {
      assert.ok(answered && card, 'Dependency failed: no home card');
      const homeRequests = [];
      const onRequest = r => { if (apiPath(r, '/api/home')) homeRequests.push({ url: r.url(), body: r.postData() }); };
      page.on('request', onRequest);
      try {
        await card.getByRole('button', { name: /Open on the map/ }).click();
        await page.waitForURL(isPath('/explore/home'));
        const panel = page.getByTestId('home-screen');
        await panel.waitFor({ state: 'visible' });
        const matches = panel.locator('ol > li');
        await poll(async () => await matches.count() >= 1, 'Home result shown on the Home screen');
        const legend = page.getByText(/The terrain shows\s+Kreuzberg, Berlin\s+printed over/);
        await legend.waitFor({ state: 'visible' });
        assert.equal(await panel.getByTestId('home-neighborhood').inputValue(), 'Kreuzberg');
        stateOf(page);
        // Give a stray refetch time to appear before declaring there was none.
        await page.waitForTimeout(3000);
        assert.equal(homeRequests.length, 0, `Opening the card refetched /api/home: ${JSON.stringify(homeRequests)}`);
        await mapReady(page);
        await shot(page, 'home-from-assistant');
        return { path: pathOf(page), matches: await matches.count(), legend: await legend.innerText(), homeRequests: 0 };
      } finally { page.off('request', onRequest); }
    });
  });
  await scenario('10', 'No unexpected console.error or uncaught page errors across all pages', async () => {
    await step('Audit all scenarios, desktop/mobile/new-tab console and pageerror', page, async () => {
      await Promise.all(pendingEvidence);
      const unexpected = consoleErrors.filter(e => !expected4xx(e));
      if (unexpected.length) {
        for (const e of unexpected) if (e.screenshot && !active.screenshots.includes(e.screenshot)) active.screenshots.push(e.screenshot);
        throw new Error(`${unexpected.length} unexpected errors: ${unexpected.map(e => `[scenario ${e.scenario}] ${e.kind}: ${e.text} (${e.location.url || e.pageUrl})`).join('\n')}`);
      }
      return { unexpected: 0, expectedIntentional4xx: consoleErrors.filter(expected4xx).length };
    });
  });
} catch (e) {
  fatalError = e.stack || e.message;
  console.error(`RUNNER FAIL: ${e.stack || e.message}`);
  await saveReport(e.stack || e.message);
  process.exitCode = 1;
} finally {
  await Promise.all(pendingEvidence);
  if (browser) await browser.close();
}
await saveReport();
const failures = results.filter(r => r.status === 'FAIL').length;
console.log(`\n${results.length - failures} PASS / ${failures} FAIL — ${resolve(reportDir, 'report.md')}`);
if (failures || results.length !== (ONLY ? ONLY.length : SCENARIO_COUNT)) process.exitCode = 1;
