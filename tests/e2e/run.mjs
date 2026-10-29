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
async function countAtLeast(p, id, min) {
  const loc = p.getByTestId(id);
  await poll(async () => {
    const count = await loc.count();
    assert.ok(count >= min, `${id}: expected >= ${min}, observed ${count}`);
    return true;
  }, `${id}: expected >= ${min}`);
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
async function mapReady(p, timeout = TIMEOUT) {
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
  if (e.kind !== 'console.error' || e.scenario !== '9' || !/Failed to load resource:.*\b4\d\d\b/i.test(e.text)) return false;
  // Only exact resource URLs with an observed intentional edge-case 4xx qualify.
  return httpErrors.some(r => r.scenario === '9' && r.status >= 400 && r.status < 500 && r.url === e.location.url && (
    new URL(r.url).pathname === '/nope' ||
    (new URL(r.url).pathname === '/api/search' && new URL(r.url).searchParams.get('q') === 'qwzxv') ||
    (['/api/field', '/api/neighborhoods', '/api/fingerprint'].includes(new URL(r.url).pathname) && (() => { try { return JSON.parse(r.requestBody).city === 'Lisbonn'; } catch { return false; } })())
  ));
}
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
      const stops = await countAtLeast(page, 'plan-stop', 6);
      await page.getByTestId('plan-stop').first().scrollIntoViewIfNeeded();
      await shot(page, 'plan');
      return { stops };
    });
  });
  await scenario('5', 'Agent less touristy reply and Crowd change within 20 seconds', async () => {
    await step('Agent replies >= 20 characters and range moves above 0.5', page, async () => {
      if (!await page.getByTestId('agent-input').count()) await openTaste(page);
      const dial = page.getByRole('slider', { name: 'Popular or local' });
      const before = Number(await dial.inputValue());
      const input = page.getByTestId('agent-input');
      const chat = input.locator('xpath=ancestor::form/parent::div');
      // Assistant final paragraphs have leading-relaxed; user bubbles and tool
      // traces have different markup. Never count the echoed prompt/tool trace.
      const replies = chat.locator('p.leading-relaxed');
      const oldCount = await replies.count();
      await input.fill('less touristy');
      const begin = performance.now();
      await input.press('Enter');
      await poll(async () => await replies.count() > oldCount && (await replies.last().innerText()).trim().length >= 20 && Number(await dial.inputValue()) > 0.5, 'New assistant reply >= 20 chars AND Crowd > 0.5', Math.max(1, TIMEOUT - (performance.now() - begin)));
      const responseMs = Math.round(performance.now() - begin);
      assert.ok(responseMs <= TIMEOUT, `Agent took ${responseMs} ms > 20000 ms`);
      const after = Number(await dial.inputValue());
      assert.ok(after > before, `Crowd did not increase: ${before} → ${after}`);
      await shot(page, 'agent');
      return { responseMs, before, after, reply: await replies.last().innerText() };
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
      await openTaste(page);
      const responsePromise = page.waitForResponse(r => new URL(r.url()).pathname === '/api/neighborhoods' && r.request().postDataJSON()?.city === 'Lisbonn', { timeout: TIMEOUT });
      void responsePromise.catch(() => {});
      await page.getByTestId('city-combobox').fill('Lisbonn');
      await page.getByTestId('city-combobox').press('Enter');
      await poll(() => stateOf(page).c === 'Lisbonn', 'URL city committed to Lisbonn');
      // Wait for a response for the misspelled city so old Lisbon rows cannot pass.
      const response = await responsePromise;
      await response.finished();
      const body = await response.json();
      let outcome;
      await poll(async () => {
        const names = body.neighborhoods?.map(n => n.name) || [];
        if (response.ok() && names.length && (await page.getByTestId('neighborhood-row').locator('span.truncate').allInnerTexts()).join('|') === names.join('|')) { outcome = { type: 'results', neighborhoods: names }; return true; }
        const note = page.locator('p').filter({ hasText: /couldn.t|could not|not find|not found|try|unavailable|offline|slow|no named neighborhoods|no .*data|city.*(recogn|locat|support)|larger city/i });
        for (const item of await note.all()) if (await item.isVisible()) { outcome = { type: 'visible-feedback', text: await item.innerText() }; return true; }
        return false;
      }, 'Results or understandable error for Lisbonn');
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
if (failures || results.length !== 10) process.exitCode = 1;
