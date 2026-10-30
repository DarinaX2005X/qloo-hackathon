// Package Q (stage 09): purposeful screenshots + measurable UI gates (§11.1, §12.2 "Метрики UI", §13).
// Usage: node tests/e2e/09/qa-ui.mjs [landing,shortlist,deeplinks]
// Screenshots go to tasks/09-qa/shots/<round>/; they support an agent visual review, never "human approved".
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Recorder, BASE, QA_DIR, stateFor, CLIENT_IP } from './lib.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/user/Desktop/qloo/deck/node_modules/playwright');
const only = (process.argv[2] ?? 'landing,shortlist,deeplinks').split(',');
const rec = new Recorder(`ui-${only.join('+')}`);
const shotDir = join(QA_DIR, 'shots', `${rec.started.toISOString().replace(/[:.]/g, '-')}-${rec.revision.rev}`);
mkdirSync(shotDir, { recursive: true });
const VIS = 'agent visual', AUTO = 'automated';
const DESK = { width: 1440, height: 900 }, MOB = { width: 390, height: 844 };
const BANNED = [/\bMatch\s*\d{1,3}\b/, /\d+\s*%\s*alike/i, /adjusted match lift/i, /negative adjusted/i, /\bAI[- ]powered\b/i];

const b64u = s => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function urlFor(profileName, city, path = '/explore') {
  const st = stateFor(profileName, city);
  const compact = { c: st.city, l: st.loves.map(l => ({ q: l.query, id: l.chosen.id, n: l.chosen.name, d: l.chosen.domain })) };
  return `${BASE}${path}?s=${b64u(JSON.stringify(compact))}`;
}

const browser = await chromium.launch({ headless: true });
const consoleErrors = [];
async function newPage(viewport, label) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: viewport.width < 768, hasTouch: viewport.width < 768 });
  // own rate bucket for app API calls only; third-party tile requests must stay untouched (custom headers trigger CORS preflight)
  await ctx.route(u => u.origin === new URL(BASE).origin && u.pathname.startsWith('/api/'), route => route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': CLIENT_IP } }));
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push({ label, url: page.url(), text: m.text().slice(0, 300) }); });
  page.on('pageerror', e => consoleErrors.push({ label, url: page.url(), text: `pageerror ${String(e).slice(0, 300)}` }));
  return { ctx, page };
}
async function shot(page, name) { const f = join(shotDir, `${name}.png`); await page.screenshot({ path: f }); return f; }
const safeText = async page => { for (let i = 0; i < 3; i++) { try { return await page.evaluate(() => document.body.innerText); } catch { await page.waitForTimeout(1500); } } return ''; };
async function copyScan(page, label) {
  const text = await safeText(page);
  const hits = BANNED.map(rx => text.match(rx)?.[0]).filter(Boolean);
  const selects = await page.locator('select').count();
  rec.check(`ui.copy.${label}`, '12.2 0 "Match NN" / "% alike" / lift labels; no native <select>', AUTO, hits.length || selects ? 'FAIL' : 'PASS', `banned: ${hits.join(', ') || 'none'}; native selects ${selects}`);
}
async function overflow(page, label) {
  const o = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, vw: window.innerWidth })).catch(() => ({ doc: 0, vw: 0 }));
  rec.check(`ui.overflow.${label}`, '13.5 no horizontal page scroll', AUTO, o.doc <= o.vw + 1 ? 'PASS' : 'FAIL', `scrollWidth ${o.doc} vs ${o.vw}`);
}

async function landing() {
  for (const [vp, label, budget] of [[DESK, 'desktop', 1500], [MOB, 'mobile', 2000]]) {
    const { ctx, page } = await newPage(vp, `landing-${label}`);
    const t0 = Date.now();
    await page.goto(BASE + '/', { waitUntil: 'commit' });
    let readyMs = null, heading = null, blocked = null;
    while (readyMs == null && Date.now() - t0 < 20000) {
      const r = await page.evaluate(() => {
        const h = document.querySelector('h1');
        const input = [...document.querySelectorAll('input:not([type=hidden]), textarea, [contenteditable=true]')].find(el => { const b = el.getBoundingClientRect(); return b.width > 20 && b.height > 10 && b.top < window.innerHeight && !el.disabled; });
        if (!h || !input) return null;
        const b = input.getBoundingClientRect();
        const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return { heading: h.innerText.slice(0, 120), reachable: !!top && (top === input || input.contains(top) || top.contains(input) || top.closest('label') != null) };
      }).catch(() => null);
      if (r && r.reachable) { readyMs = Date.now() - t0; heading = r.heading; } else if (r) blocked = 'input covered by another element';
      if (readyMs == null) await page.waitForTimeout(25);
    }
    rec.check(`ui.landing.${label}.ready`, `11.1 heading + usable input <= ${budget}ms cold (no fullscreen loader)`, AUTO, readyMs != null && readyMs <= budget ? 'PASS' : 'FAIL', `ready ${readyMs ?? 'never (20s)'}ms; heading "${heading ?? ''}"${blocked && readyMs == null ? `; ${blocked}` : ''}`);
    await page.waitForTimeout(5000);
    const canvases = await page.evaluate(() => [...document.querySelectorAll('canvas')].filter(c => { const b = c.getBoundingClientRect(); return b.width > 50 && b.height > 50 && b.top < window.innerHeight && b.bottom > 0; }).length);
    rec.check(`ui.landing.${label}.canvas`, '11.2 one WebGL canvas in the first viewport', AUTO, canvases <= 1 ? 'PASS' : 'FAIL', `${canvases} canvases in first viewport`);
    const f = await shot(page, `landing-${label}`);
    rec.check(`ui.landing.${label}.shot`, '13.1 first screen: headline, two entry points, example result labelled', VIS, 'INFO', f);
    await copyScan(page, `landing-${label}`); await overflow(page, `landing-${label}`);
    await ctx.close();
  }
}

async function shortlist() {
  for (const [vp, label] of [[DESK, 'desktop'], [MOB, 'mobile']]) {
    const { ctx, page } = await newPage(vp, `shortlist-${label}`);
    const respP = page.waitForResponse(r => /\/api\/neighborhoods/.test(r.url()) && r.request().method() === 'POST', { timeout: 60_000 }).catch(() => null);
    const t0 = Date.now();
    await page.goto(urlFor('reader', 'Lisbon'), { waitUntil: 'domcontentloaded' });
    const resp = await respP;
    let names = [];
    if (resp) { try { const j = await resp.json(); names = (j.areas ?? []).map(a => a.area?.name).concat((j.neighborhoods ?? []).map(n => n.name)).filter(Boolean).slice(0, 3); } catch { /* ignore */ } }
    let shownMs = null;
    for (let i = 0; i < 120 && shownMs == null && names.length; i++) {
      const vis = await page.evaluate(n => document.body.innerText.includes(n), names[0]);
      if (vis) shownMs = Date.now() - t0; else await page.waitForTimeout(250);
    }
    rec.check(`ui.shortlist.${label}.time`, '11.1 shortlist with evidence visible (<=7s cold for a ready manifest)', AUTO, shownMs != null && shownMs <= 7000 ? 'PASS' : shownMs != null ? 'PARTIAL' : 'FAIL', `HTTP ${resp?.status() ?? 'no request'}; first area "${names[0] ?? '?'}" visible after ${shownMs ?? 'never'}ms`);
    await page.waitForTimeout(3000);
    const geo = await page.evaluate(() => {
      const c = [...document.querySelectorAll('canvas')].sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
      const b = c?.getBoundingClientRect();
      // visible map share: canvas width minus the widest panel overlapping it
      const panels = [...document.querySelectorAll('aside, [role=complementary], [data-panel], section, nav')].map(p => p.getBoundingClientRect()).filter(r => r.height > window.innerHeight * 0.5 && r.width < window.innerWidth * 0.6 && r.width > 120);
      const covered = panels.reduce((m, r) => Math.max(m, r.width), 0);
      return { canvasW: b?.width ?? 0, canvasH: b?.height ?? 0, panelW: covered, vw: window.innerWidth, vh: window.innerHeight, markers: document.querySelectorAll('.maplibregl-marker').length };
    });
    if (label === 'desktop') {
      const share = (geo.canvasW - geo.panelW) / geo.vw;
      rec.check('ui.shortlist.desktop.map-width', '13.2 map >=55% of useful width at 1440', VIS, share >= 0.55 ? 'PASS' : 'FAIL', `canvas ${Math.round(geo.canvasW)}px, widest tall panel ${Math.round(geo.panelW)}px -> visible ≈${Math.round(share * 100)}% (heuristic; confirm on screenshot)`);
    } else {
      rec.check('ui.shortlist.mobile.map-height', '13.5 collapsed map ≈40-45% of height', VIS, 'INFO', `canvas ${Math.round(geo.canvasW)}x${Math.round(geo.canvasH)} of ${geo.vw}x${geo.vh}`);
      const lower = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('h1,h2,h3,button,[role=tab]')) { const b = el.getBoundingClientRect(); if (b.top > window.innerHeight * 0.4 && b.bottom < window.innerHeight && b.width > 0) out.push(el.innerText.trim().slice(0, 40)); }
        return out.slice(0, 12);
      });
      const resultsFirst = names.some(n => lower.some(t => t.includes(n))) || lower.some(t => /start with|shortlist|areas/i.test(t));
      rec.check('ui.shortlist.mobile.results-first', '13.5 after calculation the sheet opens on results, not on the taste form', VIS, resultsFirst ? 'PASS' : 'FAIL', `lower-viewport headings/buttons: ${lower.join(' / ')}`);
    }
    rec.check(`ui.shortlist.${label}.markers`, '13.2 three numbered candidates on the map', VIS, 'INFO', `${geo.markers} DOM markers (map may draw labels in WebGL; confirm on screenshot)`);
    const f = await shot(page, `shortlist-${label}`);
    rec.check(`ui.shortlist.${label}.shot`, '13.2 shortlist: title, 3 cards with rank, reason, two places, tradeoff', VIS, 'INFO', f);
    await copyScan(page, `shortlist-${label}`); await overflow(page, `shortlist-${label}`);
    if (label === 'desktop') {
      // gibberish taste in the real editor must not become a popular namesake (§12.3)
      try {
        await page.getByRole('button', { name: /edit/i }).first().click({ timeout: 5000 });
        const inp = page.locator('input[placeholder*="Add another"], input[placeholder*="Radiohead"]').filter({ visible: true }).first();
        await inp.fill('zxqv-no-such-band-92841', { timeout: 5000 }); await inp.press('Enter');
        await page.waitForTimeout(4000);
        const tx = await page.evaluate(() => document.body.innerText);
        rec.check('ui.taste.gibberish', '12.3 gibberish taste in the editor: no popular namesake chip (No1 Lounge at Luton Airport)', VIS, /Luton|No1 Lounge/i.test(tx) ? 'FAIL' : 'PASS', `editor text mentions Luton: ${/Luton/i.test(tx)}; unresolved feedback: ${/couldn.t find|no match|not sure|did you mean|nothing/i.test(tx)}`);
        rec.check('ui.taste.gibberish.shot', 'taste editor after gibberish', VIS, 'INFO', await shot(page, 'taste-gibberish'));
      } catch (e) { rec.check('ui.taste.gibberish', 'taste editor reachable', VIS, 'FAIL', String(e.message).slice(0, 200)); }
    }
    await ctx.close();
  }
}

async function deeplinks() {
  const { ctx, page } = await newPage(DESK, 'deeplinks');
  for (const p of ['/explore/home', '/explore/address', '/explore/why', '/explore/trip', '/explore/compare', '/explore/assistant']) {
    const r = await page.goto(urlFor('reader', 'Lisbon', p), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const notFound = await page.evaluate(() => /could not find this page|404|page not found/i.test(document.body.innerText.slice(0, 400)));
    rec.check(`ui.deeplink${p.replace(/\//g, '.')}`, '13.5 old deep link opens its context, not 404', AUTO, r?.status() === 200 && !notFound ? 'PASS' : 'FAIL', `HTTP ${r?.status()} url ${page.url().slice(0, 80)}`);
  }
  await ctx.close();
}


async function waitApi(page, rx, timeout = 90_000) {
  return page.waitForResponse(r => rx.test(r.url()) && r.request().method() === 'POST', { timeout }).catch(() => null);
}
async function settle(page, ms = 2500) { await page.waitForTimeout(ms); }
async function journey() {
  for (const [vp, label] of [[DESK, 'desktop'], [MOB, 'mobile']]) {
    const { ctx, page } = await newPage(vp, `journey-${label}`);
    // 1. Assistant: dialogue 1 typed into the real UI
    await page.goto(`${BASE}/explore/assistant?s=${b64u(JSON.stringify({ c: 'Lisbon', l: [] }))}`, { waitUntil: 'domcontentloaded' });
    await settle(page, 3000);
    const ask = page.locator('textarea[placeholder*="Ask about"], input[placeholder*="Ask about"], textarea[placeholder*="Ask"], input[placeholder*="Ask"]').filter({ visible: true }).first();
    const agentDone = page.waitForResponse(r => /\/api\/agent/.test(r.url()), { timeout: 90_000 }).catch(() => null);
    const t0 = Date.now();
    let typed = false;
    try { await ask.fill("I'm moving to Lisbon. I love Radiohead, Fleabag and Patagonia. I work from cafés. Where should I start looking?", { timeout: 10_000 }); await ask.press('Enter'); typed = true; } catch (e) { rec.check(`ui.journey.${label}.ask`, 'assistant input usable', AUTO, 'FAIL', String(e.message).slice(0, 200)); }
    if (typed) {
      const r = await agentDone;
      if (r) await r.finished().catch(() => null);
      await settle(page, 2500);
      const text = await page.evaluate(() => document.body.innerText).catch(async () => { await settle(page, 2000); return page.evaluate(() => document.body.innerText); });
      rec.check(`ui.journey.${label}.assistant`, '9 S1 in the UI: answer + area card rendered, goal status visible', VIS, r?.status() === 200 && /Alfama|Anjos|Graça|Sé|areas checked/i.test(text) ? 'PASS' : 'FAIL', `agent HTTP ${r?.status() ?? 'none'} in ${Date.now() - t0}ms; card text present: ${/areas checked|Start with/i.test(text)}; partial shown: ${/partial|unverified|needs checking|still need/i.test(text)}`);
      rec.check(`ui.journey.${label}.assistant.shot`, 'assistant after dialogue 1', VIS, 'INFO', await shot(page, `journey-${label}-1-assistant`));
      await copyScan(page, `journey-${label}-assistant`); await overflow(page, `journey-${label}-assistant`);
    }
    // 2. Home: deep link from the landing entry (from/hood) auto-runs
    const homeResp = waitApi(page, /\/api\/home/);
    await page.goto(`${urlFor('dialogue 1', 'Lisbon', '/explore/home')}&from=Berlin&hood=Kreuzberg`, { waitUntil: 'domcontentloaded' });
    const hr = await homeResp; if (hr) await hr.finished().catch(() => null);
    await settle(page);
    const ht = await safeText(page);
    rec.check(`ui.journey.${label}.home`, '5.7/10.1 Home: overlap shown as index /100 with source places and shared features, no % alike', VIS, hr?.status() === 200 && /\/\s?100|overlap/i.test(ht) && !/% alike/i.test(ht) ? 'PASS' : 'FAIL', `home HTTP ${hr?.status() ?? 'no request'}; "/100" present ${/\/\s?100/.test(ht)}; "overlap" ${/overlap/i.test(ht)}; weak-match wording ${/weak|no clear|similar/i.test(ht)}`);
    rec.check(`ui.journey.${label}.home.shot`, 'Home Kreuzberg -> Lisbon', VIS, 'INFO', await shot(page, `journey-${label}-2-home`));
    await copyScan(page, `journey-${label}-home`);
    // 3. Address
    await page.goto(urlFor('dialogue 1', 'Lisbon', '/explore/address'), { waitUntil: 'domcontentloaded' });
    await settle(page, 2500);
    const addr = page.locator('input[placeholder*="For example"], input[placeholder*="street"]').filter({ visible: true }).first();
    const spotResp = waitApi(page, /\/api\/spot/);
    try { await addr.fill('Rua da Rosa 120', { timeout: 10_000 }); await addr.press('Enter'); } catch (e) { rec.check(`ui.journey.${label}.address.input`, 'address input usable', AUTO, 'FAIL', String(e.message).slice(0, 200)); }
    const sr = await spotResp; if (sr) await sr.finished().catch(() => null);
    await settle(page);
    const at = await safeText(page);
    rec.check(`ui.journey.${label}.address`, '13.4 address: precision line visible (street, building unverified), area, nearby places', VIS, sr?.status() === 200 && /street/i.test(at) && !/Better than \d+%/i.test(at) ? 'PASS' : 'FAIL', `spot HTTP ${sr?.status() ?? 'no request'}; "street" ${/street/i.test(at)}; "Encarnação" ${/Encarna/i.test(at)}; old "Better than N%" ${/Better than \d+%/i.test(at)}`);
    rec.check(`ui.journey.${label}.address.shot`, 'Address Rua da Rosa 120', VIS, 'INFO', await shot(page, `journey-${label}-3-address`));
    await copyScan(page, `journey-${label}-address`);
    // 4. Why
    const decResp = waitApi(page, /\/api\/decides/);
    await page.goto(urlFor('indie outdoors', 'Lisbon', '/explore/why'), { waitUntil: 'domcontentloaded' });
    const dr = await decResp; if (dr) await dr.finished().catch(() => null);
    await settle(page);
    const wt = await safeText(page);
    let claims = [];
    try { claims = ((await dr?.json()) ?? {}).claims?.map(c => c.text) ?? []; } catch { /* body unavailable */ }
    const moveClaim = claims.find(c => /moves from #\d+ to #\d+|drops out/.test(c));
    const saysStable = /stable when any one love is removed/i.test(wt);
    const agrees = moveClaim ? wt.includes(moveClaim) && !saysStable : /stable|stays/i.test(wt);
    rec.check(`ui.journey.${label}.why`, '5.9/10.1 Why: the UI repeats the API counterfactual (or stability when the API claims no move)', VIS, dr?.status() === 200 && agrees ? 'PASS' : 'FAIL', `decides HTTP ${dr?.status() ?? 'no request'}; API claims: ${claims.join(' / ') || 'none'}; UI says stable: ${saysStable}`);
    rec.check(`ui.journey.${label}.why.shot`, 'Why this area (indie outdoors, Lisbon)', VIS, 'INFO', await shot(page, `journey-${label}-4-why`));
    await copyScan(page, `journey-${label}-why`);
    // 5. Visit and Compare screens as they open from a deep link
    for (const [p, nm] of [['/explore/trip', '5-visit'], ['/explore/compare', '6-compare']]) {
      await page.goto(urlFor('dialogue 1', 'Lisbon', p), { waitUntil: 'domcontentloaded' });
      await settle(page, 5000);
      rec.check(`ui.journey.${label}.${nm}.shot`, `${p} opened from deep link`, VIS, 'INFO', await shot(page, `journey-${label}-${nm}`));
      await copyScan(page, `journey-${label}-${nm}`); await overflow(page, `journey-${label}-${nm}`);
    }
    await ctx.close();
  }
}

// §12.3 / F0 acceptance: an older answer arriving late must not overwrite the newer one (latency injected, content untouched)
async function race() {
  const { ctx, page } = await newPage(DESK, 'race');
  const seen = []; let delayed = 0;
  await ctx.route(u => /\/api\/neighborhoods/.test(u.pathname), async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    const entry = { rev: body.stateRevision, loves: (body.state?.loves ?? body.loves ?? []).map(l => `${l.query}:${l.weight}`).join(','), at: Date.now() };
    seen.push(entry);
    if (seen.length === 2) { delayed = 7000; await new Promise(r => setTimeout(r, 7000)); }
    const resp = await route.fetch({ headers: { ...route.request().headers(), 'x-forwarded-for': CLIENT_IP } });
    const j = await resp.json().catch(() => null);
    entry.top = j?.areas?.slice(0, 3).map(a => a.area.name) ?? j?.neighborhoods?.slice(0, 3).map(n => n.name);
    entry.done = Date.now();
    await route.fulfill({ response: resp, json: j ?? undefined });
  });
  await page.goto(urlFor('reader', 'Lisbon'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  try {
    await page.getByRole('button', { name: /edit/i }).first().click({ timeout: 5000 });
    await page.getByRole('button', { name: /Radiohead/ }).first().click({ timeout: 5000 });
    await page.getByRole('button', { name: 'A little' }).click({ timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
    await page.getByRole('button', { name: /Haruki Murakami/ }).first().click({ timeout: 5000 });
    await page.getByRole('button', { name: 'Remove' }).click({ timeout: 5000 });
    await page.keyboard.press('Escape');
    const show = page.getByRole('button', { name: /Show my areas/ });
    if (await show.count()) await show.first().click({ timeout: 3000 }).catch(() => {});
  } catch (e) { rec.check('ui.race.steps', 'race steps reachable in the taste editor', AUTO, 'FAIL', String(e.message).slice(0, 200)); }
  for (let i = 0; i < 90 && (seen.length < 3 || seen.some(x => !x.done)); i++) await page.waitForTimeout(500);
  await page.waitForTimeout(2500);
  const text = await safeText(page);
  const last = seen.filter(s => s.top).sort((a, b) => (b.rev ?? 0) - (a.rev ?? 0))[0];
  const delayedReq = seen[1];
  const shownLast = last?.top?.[0] && text.includes(last.top[0]);
  const lastIsDelayed = last === delayedReq;
  rec.check('ui.race.stale', '12.3 0 stale overwrites: a late older answer does not replace the newer result', AUTO,
    seen.length < 3 || seen.some(x => !x.done) ? 'BLOCKED' : lastIsDelayed ? 'FAIL' : shownLast ? 'PASS' : 'FAIL',
    `requests ${seen.map(s => `rev${s.rev}[${s.loves}] -> ${s.top?.join('/') ?? '?'} ${s.done ? `+${s.done - s.at}ms` : 'pending'}`).join(' | ')}; delayed #2 by ${delayed}ms; newest top "${last?.top?.[0]}" visible: ${shownLast}`);
  rec.check('ui.race.shot', 'shortlist after the race', VIS, 'INFO', await shot(page, 'race-final'));
  await ctx.unrouteAll({ behavior: 'ignoreErrors' });
  await ctx.close();
}

// F3 acceptance: the visit from an agent card opens on /explore/trip with the same stops and the same constraints
async function visitcard() {
  for (const [vp, label] of [[DESK, 'desktop'], [MOB, 'mobile']]) {
    const { ctx, page } = await newPage(vp, `visitcard-${label}`);
    await page.goto(urlFor('dialogue 1', 'Lisbon', '/explore/assistant'), { waitUntil: 'domcontentloaded' });
    await settle(page, 3000);
    const ask = page.locator('textarea[placeholder*="Ask about"], input[placeholder*="Ask about"]').filter({ visible: true }).first();
    const done = page.waitForResponse(r => /\/api\/agent/.test(r.url()), { timeout: 90_000 }).catch(() => null);
    try {
      await ask.fill('Check Rua da Rosa 120 for me. Then plan a relaxed afternoon nearby, no museums, no bars, and only places within $$ where you know the price.', { timeout: 10_000 });
      await ask.press('Enter');
    } catch (e) { rec.check(`ui.visitcard.${label}`, 'assistant input usable', AUTO, 'FAIL', String(e.message).slice(0, 200)); await ctx.close(); continue; }
    const r = await done; if (r) await r.finished().catch(() => null);
    await settle(page, 3000);
    const chatText = await safeText(page);
    const stopsInChat = [...chatText.matchAll(/(\d{2}:\d{2})\s+([^\n]+)/g)].map(m => m[2].trim()).slice(0, 6);
    rec.check(`ui.visitcard.${label}.chat.shot`, 'assistant after dialogue 4 (address + visit cards)', VIS, 'INFO', await shot(page, `visitcard-${label}-1-chat`));
    const open = page.getByRole('button', { name: /Open the walk/ }).or(page.getByRole('link', { name: /Open the walk/ }));
    if (!(await open.count())) { rec.check(`ui.visitcard.${label}.open`, 'visit card has "Open the walk"', VIS, 'FAIL', `agent HTTP ${r?.status()}; chat stops: ${stopsInChat.join('; ')}`); await ctx.close(); continue; }
    await open.first().click();
    await settle(page, 4000);
    const tripText = await safeText(page);
    const path = new URL(page.url()).pathname;
    const chips = ['No bars', 'No museums', '$$ or less'].map(c => [c, tripText.includes(c)]);
    rec.check(`ui.visitcard.${label}.open`, 'F3: open from card lands on /explore/trip with the same constraints visible', VIS,
      path === '/explore/trip' && chips.every(([, v]) => v) ? 'PASS' : 'FAIL', `path ${path}; constraint labels present: ${chips.map(([c, v]) => `${c}=${v}`).join(', ')}; chat stops: ${stopsInChat.join('; ').slice(0, 200)}`);
    rec.check(`ui.visitcard.${label}.trip.shot`, 'visit opened from the agent card', VIS, 'INFO', await shot(page, `visitcard-${label}-2-trip`));
    await copyScan(page, `visitcard-${label}`); await overflow(page, `visitcard-${label}`);
    await ctx.close();
  }
}

const suites = { landing, shortlist, deeplinks, journey, race, visitcard };
console.log(`Q ui ${only.join(',')} against ${BASE} rev ${rec.revision.rev}; shots ${shotDir}`);
for (const s of only) { try { await suites[s](); } catch (e) { rec.check(`ui.${s}.runner`, 'suite completed', AUTO, 'FAIL', String(e?.stack ?? e).slice(0, 400)); } }
rec.check('ui.console', 'no console errors / page errors on visited pages', AUTO, consoleErrors.length ? 'FAIL' : 'PASS', consoleErrors.slice(0, 6).map(e => `${e.label}: ${e.text}`).join(' || ') || 'none');
await browser.close();
rec.write();
