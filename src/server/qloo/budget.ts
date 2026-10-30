import { AsyncLocalStorage } from "node:async_hooks";
import { apiError } from "@/shared/contracts";

type Budget = { limit: number; used: number; closed: boolean };
// Next bundles and tsx can load ESM/CJS copies of this module. They must share one
// request context, just as the Qloo client shares its process-wide cache/queue.
const processGlobal = globalThis as typeof globalThis & { __homingQlooBudgetScope?: AsyncLocalStorage<Budget[]> };
const scope = processGlobal.__homingQlooBudgetScope ??= new AsyncLocalStorage<Budget[]>();

/** Nested operations charge both their own ceiling and the enclosing HTTP request. */
export async function withQlooBudget<T>(limit: number, run: () => Promise<T>, finish?: (used: number) => void): Promise<T> {
  const budget: Budget = { limit, used: 0, closed: false };
  return scope.run([...(scope.getStore() ?? []), budget], async () => {
    try { return await run(); }
    finally { budget.closed = true; finish?.(budget.used); }
  });
}

export function remainingQlooCalls(): number {
  const budgets = scope.getStore() ?? [];
  return budgets.length ? Math.min(...budgets.map(b => b.closed ? 0 : b.limit - b.used)) : Infinity;
}

/** Reserve synchronously before queueing transport work; concurrency cannot overspend. */
export function consumeQlooCall(): void {
  const budgets = scope.getStore() ?? [];
  if (budgets.some(b => b.closed || b.used >= b.limit))
    throw apiError("quota", "This request reached its search limit. Try a smaller request.", true);
  for (const budget of budgets) budget.used++;
}
