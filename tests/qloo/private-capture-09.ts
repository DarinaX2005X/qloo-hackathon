import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Test instrumentation only. Never import into production. No headers or credentials are persisted. */
export function installPrivateCapture(frozen = false) {
  const directory = process.env.HOMING_EVIDENCE_DIR || join(tmpdir(), "homing-stage09-private");
  mkdirSync(directory, { recursive: true });
  const original = globalThis.fetch;
  const records = new Map<string, { fetchedAt: string; status: number; value: unknown }>();
  const keyOf = (path: string, params: Record<string, unknown>) => JSON.stringify([path, Object.entries(params).map(([k, v]) => [k, String(v)]).sort(([a], [b]) => a.localeCompare(b))]);
  if (frozen) for (const file of readdirSync(directory).filter(f => /^[a-f0-9]{64}\.json$/.test(f))) {
    const saved = JSON.parse(readFileSync(join(directory, file), "utf8"));
    if (saved.status === 200 && saved.path && saved.params) records.set(keyOf(saved.path, saved.params), saved);
  }
  let networkCalls = 0, replayed = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (!url.hostname.includes("qloo")) return original(input, init);
    const key = keyOf(url.pathname, Object.fromEntries(url.searchParams));
    const saved = records.get(key);
    if (frozen && saved) { replayed++; return Response.json(saved.value, { status: saved.status }); }
    const started = performance.now();
    const response = await original(input, init); networkCalls++;
    const value = await response.clone().json().catch(() => null);
    const capture = { fetchedAt: new Date().toISOString(), path: url.pathname, params: Object.fromEntries(url.searchParams), status: response.status, elapsedMs: performance.now() - started, value };
    const hash = createHash("sha256").update(key).digest("hex");
    if (!existsSync(join(directory, `${hash}.json`)) || response.status === 200) writeFileSync(join(directory, `${hash}.json`), JSON.stringify(capture));
    if (response.ok) records.set(key, capture);
    return response;
  };
  return { directory, counts: () => ({ networkCalls, replayed }), restore: () => { globalThis.fetch = original; } };
}
