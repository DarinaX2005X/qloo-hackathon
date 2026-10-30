// Offline transport smoke test across tsx's ESM/CJS module boundary.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { withQlooBudget } from '../../src/server/qloo/budget';
const require = createRequire(import.meta.url);
const { qlooGet } = require('../../src/server/qloo/client.ts') as typeof import('../../src/server/qloo/client');
process.env.QLOO_API_KEY = 'synthetic-offline-key';
let sent = 0, charged = 0;
globalThis.fetch = async () => { sent++; return Response.json({ results: [] }); };
const outcomes = await withQlooBudget(3, () => Promise.allSettled(Array.from({ length: 12 }, (_, i) => qlooGet('/search', { query: `offline-${i}` }))), used => { charged = used; });
assert.equal(sent, 3); assert.equal(charged, 3);
assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 3);
console.log('PASS: ESM request budget limits CJS Qloo transport to 3 of 12 attempts.');
