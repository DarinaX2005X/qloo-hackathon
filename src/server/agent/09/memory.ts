import type { AgentCardV2, EvidenceRef, GoalState, ResultMeta, SessionMemory } from "@/shared/contracts-09";
import type { DecisionPlan } from "./planning";

export type SavedResult = { id: string; meta: ResultMeta; card: AgentCardV2; evidence: EvidenceRef[]; city: string; areaIds: string[] };
export type SavedTurn = { plan: DecisionPlan; goals: GoalState[]; memory: SessionMemory; results: SavedResult[]; message: string; planningComplete?: boolean; preparationComplete?: boolean };
type Session = { expires: number; results: Map<string, SavedResult>; turns: SavedTurn[] };
const globalStore = globalThis as typeof globalThis & { __homingAgent09?: Map<string, Session> };
const sessions = globalStore.__homingAgent09 ??= new Map<string, Session>();
const TTL = 2 * 60 * 60_000;
function session(id: string, create = false): Session | undefined {
  let value = sessions.get(id);
  if (value && value.expires <= Date.now()) { sessions.delete(id); value = undefined; }
  if (!value && create) { value = { expires: Date.now() + TTL, results: new Map(), turns: [] }; sessions.set(id, value); }
  if (sessions.size > 100) sessions.delete(sessions.keys().next().value!);
  return value;
}
export function clearAgentMemory(): void { sessions.clear(); }
export function rememberResult(sessionId: string, result: SavedResult): void {
  const value = session(sessionId, true)!;
  value.expires = Date.now() + TTL;
  value.results.set(result.id, structuredClone(result));
  if (value.results.size > 40) value.results.delete(value.results.keys().next().value!);
}
export function rememberedResults(sessionId: string): SavedResult[] { return [...(session(sessionId)?.results.values() ?? [])].map(r => structuredClone(r)); }
export function rememberTurn(sessionId: string, turn: SavedTurn): void {
  const value = session(sessionId, true)!; value.expires = Date.now() + TTL;
  value.turns.push(structuredClone(turn)); value.turns = value.turns.slice(-12);
}
export function retryTurn(sessionId: string, goalId: string): SavedTurn | undefined {
  const turn = session(sessionId)?.turns.findLast(t => t.goals.some(g => g.id === goalId));
  return turn ? structuredClone(turn) : undefined;
}
