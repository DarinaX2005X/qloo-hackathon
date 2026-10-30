import { ExploreState, activeLoves, type StatePatch } from "@/shared/contracts";
import { applyPatches } from "@/shared/patches";
import {
  AgentRequestV2, AgentEventV2, AnalysisRequestV2, HomeRequestV2, CitiesRequestV2, SpotRequestV2, PlacesRequestV2, PlanRequestV2,
  type GoalState, type Claim, type EvidenceRef, type SessionMemory, type AreaDecision, type HomeResponseV2, type PlacesResponseV2, type SpotResponseV2,
} from "@/shared/contracts-09";
import { profileHash, normalized, uniqueEvidence } from "@/server/engine/09/core";
import { remainingQlooCalls, withQlooBudget } from "@/server/qloo/budget";
import { asFailure, withSignal } from "../errors";
import { auditExecution, claimsForCard, type GoalAudit } from "./audit";
import { mergeConstraints } from "./constraints";
import { DecisionPlan, proposePlan, chooseRecovery, planGoals, requestedGoals, guardPlan, type RecoveryOption } from "./planning";
import { prepareProfile, preparationServices, sameRevisionInputs, type PreparationServices } from "./prepare";
import { rememberResult, rememberedResults, rememberTurn, retryTurn, type SavedResult } from "./memory";
import { callTool, services, resultEnvelope, validateClaims, toolLabels, type Execution, type Services, type ToolName, type ToolResponse } from "./tools";
import { acknowledgement, AGENT09_TIMEOUT_MS } from "./protocol";
export { serializeEventV2, AGENT09_TIMEOUT_MS } from "./protocol";

export const AGENT09_QLOO_BUDGET = 192;
export const AGENT09_TOOL_LIMIT = 8;
export const AGENT09_RECOVERY_LIMIT = 2;
type Dependencies = { services: Services; preparation: PreparationServices; plan: typeof proposePlan; recovery: typeof chooseRecovery; deadlineMs: number; acknowledged: boolean };
const defaults: Dependencies = { services, preparation: preparationServices, plan: proposePlan, recovery: chooseRecovery, deadlineMs: AGENT09_TIMEOUT_MS, acknowledged: false };
const goalTitle: Record<GoalState["kind"], string> = { choose_area: "Choose an area to explore", compare_cities: "Compare the requested cities", evaluate_address: "Check the address", find_venues: "Find suitable places", build_visit: "Build the visit" };

export async function runAgentV2(raw: AgentRequestV2, emit: (event: AgentEventV2) => void, parentSignal?: AbortSignal, overrides: Partial<Dependencies> = {}): Promise<{ state: ExploreState; memory: SessionMemory; goals: GoalState[] }> {
  return withQlooBudget(AGENT09_QLOO_BUDGET, () => run(raw, emit, parentSignal, { ...defaults, ...overrides }));
}
async function run(raw: AgentRequestV2, emit: (event: AgentEventV2) => void, parentSignal: AbortSignal | undefined, deps: Dependencies): Promise<{ state: ExploreState; memory: SessionMemory; goals: GoalState[] }> {
  let input = AgentRequestV2.parse(raw);
  const started = performance.now();
  const deadline = new AbortController(), timer = setTimeout(() => deadline.abort(), deps.deadlineMs);
  const signal = parentSignal ? AbortSignal.any([parentSignal, deadline.signal]) : deadline.signal;
  const checkDeadline = () => {
    // A busy dev/server event loop can delay timer callbacks. Check elapsed time
    // at phase boundaries too, before starting more work or publishing a late card.
    if (performance.now() - started >= deps.deadlineMs) deadline.abort();
    signal.throwIfAborted();
  };
  let settled = false;
  const errorsSent = new Set<string>(), runningSteps = new Set<string>();
  const send = (event: AgentEventV2) => {
    if (settled || parentSignal?.aborted) return;
    if (event.type === "error") {
      const key = `${event.goalId}:${event.message}`;
      if (errorsSent.has(key)) return;
      errorsSent.add(key);
    }
    if (event.type === "step") { if (event.status === "running") runningSteps.add(event.stepId); else runningSteps.delete(event.stepId); }
    emit(AgentEventV2.parse(event));
  };
  let state = structuredClone(input.state), revision = input.stateRevision;
  const memory = structuredClone(input.memory);
  let plan = DecisionPlan.parse({}), toolDecisions = 0, recoveryDecisions = 0, stepNumber = 0;
  let planningComplete = false, preparationComplete = false, needsPreparation = !input.retryGoalId;
  let goals: GoalState[] = requestedGoals(input.message).map(kind => ({ id: `${input.turnId}:${kind}`, kind, status: "pending", resultIds: [], unmet: [] }));
  const completed: SavedResult[] = [], provenance: EvidenceRef[] = [], statusClaims: Claim[] = [];
  const auditParts = new Map<string, Map<string, GoalAudit>>(), failures = new Map<string, { tool: ToolName; retryable: boolean }>();
  let areas: AreaDecision[] = [], home: HomeResponseV2 | undefined, address: SpotResponseV2 | undefined, venues: PlacesResponseV2 | undefined;
  let temporaryTagIds: string[] = [], preparationUnmet: string[] = [];
  let homeBlendReported = false;
  const goal = (kind: GoalState["kind"]) => goals.find(g => g.kind === kind);
  const availableResults = () => {
    const saved = rememberedResults(input.sessionId), ids = new Set(input.memory.lastResults.map(r => r.id));
    return ids.size ? saved.filter(r => ids.has(r.id)) : saved;
  };
  const envelope = () => AnalysisRequestV2.parse({ state, stateRevision: revision, constraints: memory.constraints });
  const updateAudit = (g: GoalState, key: string, audit: GoalAudit) => {
    const parts = auditParts.get(g.id) ?? new Map<string, GoalAudit>(); parts.set(key, audit); auditParts.set(g.id, parts);
    g.unmet = [...new Set([...parts.values()].flatMap(p => p.unmet))];
    g.status = [...parts.values()].some(p => p.status === "failed") ? (g.resultIds.length ? "partial" : "failed") : g.unmet.length ? "partial" : "satisfied";
    send({ type: "observation", turnId: input.turnId, goalId: g.id, text: audit.observation, evidenceIds: audit.evidenceIds });
  };
  const needInput = (g: GoalState, reason: string) => { g.status = "needs_input"; g.unmet = [...new Set([...g.unmet, reason])]; send({ type: "error", turnId: input.turnId, goalId: g.id, retryable: false, message: reason }); };
  const commit = (ops: StatePatch[], constraints = memory.constraints) => {
    const next = ExploreState.parse(applyPatches(state, ops));
    const changed = JSON.stringify(next) !== JSON.stringify(state) || JSON.stringify(constraints) !== JSON.stringify(memory.constraints);
    if (!changed) return;
    const baseRevision = revision; if (!sameRevisionInputs(state, memory.constraints, next, constraints)) revision++;
    state = next; memory.constraints = constraints; memory.revision = revision;
    send({ type: "patch", turnId: input.turnId, baseRevision, nextRevision: revision, ops, constraints });
  };
  async function perform<K extends ToolName>(tool: K, args: Parameters<Services[K]>[0], g: GoalState): Promise<ToolResponse<K> | undefined> {
    checkDeadline();
    if (toolDecisions >= AGENT09_TOOL_LIMIT) { updateAudit(g, tool, { status: "partial", unmet: ["The remaining check needs another turn."], observation: "The completed results are kept; this check remains unfinished.", evidenceIds: [] }); return; }
    toolDecisions++; g.status = "running";
    const stepId = `${input.turnId}:step:${++stepNumber}`;
    send({ type: "step", turnId: input.turnId, stepId, status: "running", text: toolLabels[tool] });
    const publish = (data: ToolResponse<K>) => {
      checkDeadline();
      const execution = { tool, data } as Execution;
      const audit = auditExecution(execution, memory.constraints, g.id), result = resultEnvelope(execution);
      if (tool === "rank_areas" && g.kind === "build_visit" && result.card.kind === "areas" && result.card.areas.length) { audit.status = "satisfied"; audit.unmet = []; }
      const areaIds = tool === "build_visit" ? (args as PlanRequestV2).areaIds : result.card.kind === "areas" ? result.card.areas.slice(0, 3).map(a => a.area.id)
        : result.card.kind === "home" ? result.card.matches.slice(0, 3).map(a => a.area.area.id) : result.card.kind === "address" && result.card.result.area ? [result.card.result.area.area.id] : [];
      if (audit.status !== "failed") {
        const saved: SavedResult = { id: `${result.meta.analysisId}:${result.card.kind}`, ...result, city: state.city, areaIds };
        rememberResult(input.sessionId, saved);
        const previous = completed.findIndex(r => r.id === saved.id);
        if (previous < 0) completed.push(saved); else completed[previous] = saved;
        provenance.push(...result.evidence); g.resultIds = [...new Set([...g.resultIds, saved.id])];
        send({ type: "result", turnId: input.turnId, meta: result.meta, card: result.card });
      }
      return { audit, result };
    };
    const outcome = await callTool(tool, args, g.id, signal, deps.services, data => { if (!signal.aborted) publish(data); });
    if (!outcome.data) {
      failures.set(g.id, { tool, retryable: outcome.error?.retryable ?? false });
      const text = outcome.error?.message ?? "This check could not be completed.";
      send({ type: "step", turnId: input.turnId, stepId, status: "failed", text });
      updateAudit(g, tool, { status: "failed", unmet: [text], observation: text, evidenceIds: [] });
      send({ type: "error", turnId: input.turnId, goalId: g.id, retryable: outcome.error?.retryable ?? false, message: text }); return;
    }
    failures.delete(g.id);
    const { audit, result } = publish(outcome.data);
    if (audit.status !== "failed") {
      if (result.card.kind === "visit") for (const recovery of result.card.result.recoveryLog) send({ type: "replan", turnId: input.turnId, reason: recovery.reason, nextAction: recovery.action === "wider_radius" ? "Checked a wider area with the same requirements." : recovery.action === "alternate_venue" ? recovery.changedStopIds.length ? "Replaced the requested stop and rechecked the retained places." : "Checked more places for the missing role inside the selected area." : "Kept the verified stops and left the remaining gaps visible." });
    }
    send({ type: "step", turnId: input.turnId, stepId, status: audit.status === "failed" ? "failed" : "done", text: audit.observation });
    updateAudit(g, tool, audit); return audit.status === "failed" ? undefined : outcome.data;
  }
  function selectedArea(name?: string): string | undefined {
    const options = [...(home?.matches.map(m => m.area) ?? []), ...areas];
    if (name) return options.find(a => a.area.id === name || normalized(a.area.name) === normalized(name))?.area.id;
    return address?.area?.area.id ?? state.neighborhood ?? memory.selectedAreaIds[0] ?? options[0]?.area.id;
  }
  function sourceFromMemory() {
    const old = memory.sourceHome;
    return old?.cityName ? { city: old.cityName, neighborhood: old.name, areaId: old.areaId, point: old.point } : undefined;
  }
  async function runChoose(g: GoalState, blend = 0): Promise<void> {
    if (plan.source) {
      const found = await perform("translate_home", HomeRequestV2.parse({ ...envelope(), source: plan.source, lambda: blend }), g);
      if (found) {
        home = found; areas = found.matches.map(m => m.area);
        memory.sourceHome = { cityId: found.sourceSignatureSummary.cityId, cityName: found.sourceSignatureSummary.cityName, areaId: found.sourceSignatureSummary.area.id, name: found.sourceSignatureSummary.area.name, point: found.sourceSignatureSummary.area.center };
      }
    } else {
      const ranked = await perform("rank_areas", envelope(), g);
      if (ranked) {
        areas = ranked.areas;
        const previous = availableResults().findLast(r => r.card.kind === "areas" && r.meta.profileHash === profileHash(input.state, input.memory.constraints) && r.meta.manifestVersion === ranked.meta.manifestVersion);
        if (plan.ops.some(op => op.op === "set_weight") && previous?.card.kind === "areas" && previous.card.areas[0] && areas[0]) {
          const before = previous.card.areas[0], after = areas[0];
          statusClaims.push({ text: before.area.id === after.area.id ? `${after.area.name} stays first after this weight change.` : `The first area changes from ${before.area.name} to ${after.area.name} after this weight change.`, evidenceIds: [...new Set([...previous.evidence, ...ranked.evidence].map(e => e.id))] });
        }
      }
    }
    if (areas.length) memory.selectedAreaIds = areas.slice(0, 3).map(a => a.area.id);
    // Taste ablations explain the taste ranking; Home is explained by its source/target features.
    if (plan.explain && !plan.source && areas[0] && activeLoves(state.loves).length) await perform("explain_area", { ...envelope(), areaId: areas[0].area.id }, g);
  }
  async function runComparison(g: GoalState): Promise<void> {
    if (plan.cities.length < 2) { needInput(g, "Which two or three cities would you like to compare?"); return; }
    await perform("compare_cities", CitiesRequestV2.parse({ ...envelope(), cities: plan.cities, source: plan.source, criteria: [] }), g);
  }
  async function runAddress(g: GoalState): Promise<void> {
    if (!plan.address) { needInput(g, "Which address should I check in the selected city?"); return; }
    address = await perform("evaluate_address", SpotRequestV2.parse({ ...envelope(), query: plan.address, areaId: selectedArea() }), g);
    if (address) memory.lastAddress = { label: address.label, point: address.point, cityId: address.meta.cityId, ...(address.area ? { areaId: address.area.area.id } : {}), resultId: `${address.meta.analysisId}:address` };
  }
  async function runVenues(g: GoalState, wider = false): Promise<void> {
    const areaId = plan.venues?.areaName ? selectedArea(plan.venues.areaName) : /near (?:our|my|the) shortlist|nearby|together/i.test(input.message) ? selectedArea() : undefined;
    if (plan.venues?.areaName && !areaId) { needInput(g, "Choose an area from the current shortlist before searching inside it."); return; }
    venues = await perform("find_venues", PlacesRequestV2.parse({ ...envelope(), areaId: wider ? undefined : areaId, intent: plan.venues?.intent ?? "daily_life", excludeIds: memory.rejectedPlaceIds, temporaryTagIds, ...(wider ? { radiusM: 15000 } : {}) }), g);
  }
  async function runVisit(g: GoalState): Promise<void> {
    const stored = availableResults().filter(r => r.card.kind === "visit" && normalized(r.city) === normalized(state.city)).at(-1);
    const prior = stored?.card.kind === "visit" ? stored.card.result : undefined;
    const replacing = !!plan.visit?.replaceIndex || !!plan.visit?.replacePlaceName;
    let replacePlaceId: string | undefined;
    if (replacing) {
      const stops = prior?.itinerary.days.flatMap(d => d.stops) ?? [];
      replacePlaceId = plan.visit?.replaceIndex ? stops[plan.visit.replaceIndex - 1]?.place.id : stops.find(s => normalized(s.place.name) === normalized(plan.visit!.replacePlaceName!))?.place.id;
      if (!replacePlaceId) { needInput(g, "That stop is not available in this session. Open or rebuild the visit before replacing it."); return; }
      memory.rejectedPlaceIds = [...new Set([...memory.rejectedPlaceIds, replacePlaceId])].slice(-100);
    }
    if (goal("evaluate_address") && !address) { needInput(g, "The nearby visit needs the address to be located first. Retry the address check."); return; }
    let areaId = replacing ? stored?.areaIds[0] : selectedArea(plan.visit?.areaName);
    if (!areaId && !plan.visit?.areaName && !goal("evaluate_address")) {
      const ranked = await perform("rank_areas", envelope(), g); if (ranked) { areas = ranked.areas; areaId = areas[0]?.area.id; }
    }
    if (!areaId) { needInput(g, address ? "The address is outside the named comparison areas. Select a nearby area on the map for the visit." : "Choose an area on the map for this visit."); return; }
    const visitState = { ...state, days: plan.visit?.days ?? (replacing ? prior?.itinerary.days.length as 1 | 2 | 3 : 1) ?? 1, pace: plan.visit?.pace ?? "relaxed" };
    await perform("build_visit", PlanRequestV2.parse({ ...envelope(), state: visitState, areaIds: replacing ? stored!.areaIds : [areaId], date: plan.visit?.date, startHour: plan.visit?.startHour,
      excludeIds: memory.rejectedPlaceIds, includeIds: replacing ? prior!.itinerary.days.flatMap(d => d.stops.map(s => s.place.id)).filter(id => id !== replacePlaceId) : memory.savedPlaceIds,
      ...(replacing ? { existingItinerary: prior!.itinerary, replacePlaceId } : {}) }), g);
  }
  const runGoal = async (g: GoalState) => {
    switch (g.kind) {
      case "choose_area": return runChoose(g);
      case "compare_cities": return runComparison(g);
      case "evaluate_address": return runAddress(g);
      case "find_venues": return runVenues(g);
      case "build_visit": return runVisit(g);
    }
  };
  const canRecover = () => !signal.aborted && toolDecisions < AGENT09_TOOL_LIMIT && performance.now() - started < deps.deadlineMs - 6000 && remainingQlooCalls() > 0;
  const attempted = new Set<string>();
  async function recover(onlyChoose = false): Promise<void> {
    while (canRecover() && recoveryDecisions < AGENT09_RECOVERY_LIMIT) {
      const options: RecoveryOption[] = [];
      const choose = goal("choose_area"), find = goal("find_venues");
      if (choose?.status === "partial" && home && plan.allowHomeBlend && activeLoves(state.loves).length && (home.matches[0]?.similarity.value ?? 0) < 35 && !attempted.has("blend_home")) options.push({ goalId: choose.id, action: "blend_home", observation: choose.unmet.join(" ") });
      if (find?.status === "partial" && (venues?.venues.length ?? 0) < 2 && !attempted.has("wider_venue_search")) options.push({ goalId: find.id, action: "wider_venue_search", observation: find.unmet.join(" ") });
      for (const [goalId, failed] of failures) if (failed.retryable && !attempted.has(`retry:${goalId}`)) options.push({ goalId, action: "retry_tool", observation: goals.find(g => g.id === goalId)?.unmet.join(" ") ?? "The provider was unavailable." });
      if (onlyChoose) options.splice(0, options.length, ...options.filter(o => goals.find(g => g.id === o.goalId)?.kind === "choose_area"));
      if (!options.length) break;
      options.push({ goalId: options[0].goalId, action: "keep_partial", observation: "Keep the completed evidence and report the remaining limitations." });
      // The user already requested this conditional check. Once the observed
      // overlap is weak, another model cannot veto it or spend its time budget.
      const requestedBlend = options.find(o => o.action === "blend_home");
      const choice = requestedBlend ?? await withSignal(deps.recovery(options, { toolDecisions: AGENT09_TOOL_LIMIT - toolDecisions, qlooCharges: remainingQlooCalls(), timeMs: Math.max(0, deps.deadlineMs - (performance.now() - started)) }, signal), signal).catch(() => ({ action: "keep_partial" as const, goalId: options[0].goalId }));
      checkDeadline();
      recoveryDecisions++;
      const allowed = options.find(o => o.action === choice.action && o.goalId === choice.goalId);
      if (!allowed || choice.action === "keep_partial") break;
      const g = goals.find(g => g.id === choice.goalId)!;
      send({ type: "replan", turnId: input.turnId, reason: allowed.observation, nextAction: choice.action === "blend_home" ? "Compare home with a 35% contribution from your own tastes, then check the places." : choice.action === "wider_venue_search" ? "Search across the city while keeping every hard requirement." : "Retry the unavailable check while keeping the completed results." });
      attempted.add(choice.action === "retry_tool" ? `retry:${g.id}` : choice.action);
      if (choice.action === "blend_home") {
        const original = home;
        await runChoose(g, .35);
        if (original && home && home !== original && original.matches[0] && home.matches[0]) {
          const before = original.matches[0], after = home.matches[0];
          const overlap = (value: number | null) => value === null ? "too little data to score overlap" : `${value.toFixed(1)}/100 cultural-profile overlap`;
          statusClaims.push({ text: `Home alone put ${before.area.area.name} first (${overlap(before.similarity.value)}). With your tastes contributing 35% to the ordering, ${after.area.area.name} comes first (${overlap(after.similarity.value)}). The blend changes the order; it does not increase the measured cultural overlap.`, evidenceIds: uniqueEvidence([...original.evidence, ...home.evidence]).map(e => e.id) });
          homeBlendReported = true;
        }
        if (areas[0] && canRecover()) await perform("find_venues", PlacesRequestV2.parse({ ...envelope(), areaId: areas[0].area.id, intent: "daily_life", excludeIds: memory.rejectedPlaceIds }), g);
      } else if (choice.action === "wider_venue_search") await runVenues(g, true);
      else await runGoal(g);
    }
  }
  if (!deps.acknowledged) send({ type: "ack", turnId: input.turnId, text: acknowledgement(input.message) });
  try {
    if (!input.retryGoalId) commit([], mergeConstraints(memory.constraints, DecisionPlan.parse({}), input.message));
    if (input.retryGoalId) {
      const previous = retryTurn(input.sessionId, input.retryGoalId), target = previous?.goals.find(g => g.id === input.retryGoalId);
      if (!previous || !target) {
        goals = [{ id: input.retryGoalId, kind: "choose_area", status: "needs_input", resultIds: [], unmet: ["That previous step is no longer available in this server session. Please ask for the check again."] }];
        send({ type: "plan", turnId: input.turnId, goals, steps: [] });
        needInput(goals[0], goals[0].unmet[0]);
      } else {
        // A retry still means the original request. Failed planning/lookups cannot be skipped.
        input = { ...input, message: previous.message };
        goals = [{ ...target, status: "pending", resultIds: [], unmet: [] }];
        const oldPlan = previous.planningComplete ? previous.plan : guardPlan(await withSignal(deps.plan(input, signal), signal), input);
        planningComplete = true; needsPreparation = !previous.preparationComplete || !!oldPlan.venues?.temporaryIntent; preparationComplete = !needsPreparation;
        plan = DecisionPlan.parse({ ...oldPlan, goals: [target.kind], ...(!needsPreparation ? { entities: [], ops: [], constraints: [], removeConstraints: [] } : {}), ...(target.kind !== "choose_area" ? { explain: false } : {}) });
        goals = [{ ...target, status: "pending", resultIds: [], unmet: [] }];
        // Successful dependencies are reused only from this session and city; their cards remain visible in the earlier turn.
        const oldAddress = previous.results.findLast(r => r.card.kind === "address" && normalized(r.city) === normalized(state.city));
        if (target.kind === "build_visit" && oldAddress?.card.kind === "address") address = { ...oldAddress.card.result, meta: oldAddress.meta, evidence: oldAddress.evidence };
      }
    } else {
      const planStep = `${input.turnId}:understand`;
      send({ type: "step", turnId: input.turnId, stepId: planStep, status: "running", text: "Identifying the checks and requirements in your request" });
      plan = await withSignal(deps.plan(input, signal), signal);
      checkDeadline();
      plan = guardPlan(DecisionPlan.parse(plan), input);
      planningComplete = true;
      send({ type: "step", turnId: input.turnId, stepId: planStep, status: "done", text: "Prepared the checks for your request" });
      goals = planGoals(plan, input.message).map(kind => ({ id: `${input.turnId}:${kind}`, kind, status: "pending", resultIds: [], unmet: [] }));
    }
    if (!plan.source && /home|familiar|closer|old neighbou?rhood/i.test(input.message)) plan.source = sourceFromMemory();
    if (!plan.address && /nearby|around (?:the|that) address|near (?:the|that) flat|\bthere\b/i.test(input.message)) {
      const previous = availableResults().findLast(r => r.card.kind === "address" && normalized(r.city) === normalized(state.city));
      if (previous?.card.kind === "address") address = { ...previous.card.result, meta: previous.meta, evidence: previous.evidence };
    }
    if (plan.open) {
      const returned = availableResults().flatMap(r => r.card.kind === "comparison" ? r.card.result.results : []).find(c => normalized(c.cityName) === normalized(plan.open!.name));
      if (plan.open.kind === "city" && returned) {
        plan.ops = [{ op: "set_city", city: returned.cityName }]; plan.cities = [];
        if (!goal("choose_area")) goals.push({ id: `${input.turnId}:choose_area`, kind: "choose_area", status: "pending", resultIds: [], unmet: [] });
      } else if (plan.open.kind === "area") {
        const found = rememberedResults(input.sessionId).filter(r => normalized(r.city) === normalized(state.city)).flatMap(r => r.card.kind === "areas" ? r.card.areas : r.card.kind === "home" ? r.card.matches.map(m => m.area) : []).find(a => normalized(a.area.name) === normalized(plan.open!.name));
        if (found) { commit([{ op: "select_neighborhood", id: found.area.id }]); memory.selectedAreaIds = [found.area.id]; statusClaims.push({ text: `Selected ${found.area.name} on the map.`, evidenceIds: found.evidenceIds }); }
        else statusClaims.push({ text: "That area is not in the results available in this session. Choose it from the shortlist.", evidenceIds: [] });
      } else statusClaims.push({ text: "That city option is not in the comparison available in this session. Please compare the cities again.", evidenceIds: [] });
    }
    send({ type: "plan", turnId: input.turnId, goals, steps: goals.map(g => goalTitle[g.kind]) });
    if (needsPreparation) {
      toolDecisions += Number(plan.entities.length > 0) + Number(!!plan.venues?.temporaryIntent);
      const prepared = await withSignal(prepareProfile(input, plan, signal, (id, status, text) => send({ type: "step", turnId: input.turnId, stepId: `${input.turnId}:${id}`, status, text }), deps.preparation), signal);
      checkDeadline();
      preparationUnmet = prepared.unresolved; temporaryTagIds = prepared.temporaryTagIds; provenance.push(...prepared.evidence);
      preparationComplete = preparationUnmet.length === 0;
      commit(prepared.ops, prepared.constraints);
      statusClaims.push(...prepared.changes.map(text => ({ text, evidenceIds: prepared.evidence.map(e => e.id) })));
    }
    if (!goals.length) {
      if (!statusClaims.length) statusClaims.push({ text: plan.clarification?.endsWith("?") ? plan.clarification : "Tell me the city, former neighborhood, address or kind of place you want to check.", evidenceIds: [] });
    } else {
      // Comparison is independent; address waits for Home only when the user also requested it.
      const primary = goals.filter(g => g.kind === "choose_area" || g.kind === "compare_cities");
      await Promise.all(primary.filter(g => g.status === "pending").map(runGoal));
      await recover(true);
      const independent = goals.filter(g => (g.kind === "evaluate_address" || g.kind === "find_venues") && g.status === "pending");
      await Promise.all(independent.map(runGoal));
      const build = goal("build_visit"); if (build?.status === "pending") await runVisit(build);
      await recover();
    }
  } catch (error) {
    if (!parentSignal?.aborted) {
      const failure = asFailure(error).body.error, message = signal.aborted ? "The remaining checks timed out. Completed results are kept; retry an unfinished step." : failure.message;
      for (const stepId of runningSteps) send({ type: "step", turnId: input.turnId, stepId, status: "failed", text: message });
      if (!goals.length) goals = [{ id: `${input.turnId}:choose_area`, kind: "choose_area", status: "pending", resultIds: [], unmet: [] }];
      for (const g of goals.filter(g => ["pending", "running"].includes(g.status))) { g.status = g.resultIds.length ? "partial" : "failed"; g.unmet.push(message); send({ type: "error", turnId: input.turnId, goalId: g.id, retryable: true, message }); }
    }
  } finally {
    clearTimeout(timer);
  }
  if (parentSignal?.aborted) return { state, memory, goals };
  if (preparationUnmet.length) {
    const g = goal("choose_area") ?? goals[0];
    if (g) { g.unmet = [...new Set([...g.unmet, ...preparationUnmet])]; g.status = g.resultIds.length ? "partial" : "needs_input"; }
    statusClaims.push(...preparationUnmet.map(text => ({ text, evidenceIds: [] })));
  }
  // Every planned obligation terminates with a visible result or an explicit message.
  for (const g of goals) {
    if (g.status === "pending" || g.status === "running" || (g.status === "satisfied" && !g.resultIds.length)) {
      g.status = g.resultIds.length ? "partial" : "failed";
      g.unmet.push("This requested check remains unfinished. Retry it to continue.");
    }
    if (!g.resultIds.length && !g.unmet.length) g.unmet.push("This check returned no usable result. Please retry it.");
    if (!g.resultIds.length) send({ type: "error", turnId: input.turnId, goalId: g.id, retryable: g.status !== "needs_input", message: g.unmet.join(" ") });
  }
  const latest = [...new Map(completed.map(r => [r.card.kind, r])).values()];
  // The goal ledger and goal-specific errors already carry the unmet reasons.
  // Keep the answer focused on the evidence instead of repeating that ledger.
  const claims = [...statusClaims, ...latest.filter(r => !homeBlendReported || r.card.kind !== "home").flatMap(r => claimsForCard(r.card, r.evidence.map(e => e.id)))];
  const evidence = uniqueEvidence([...provenance, ...rememberedResults(input.sessionId).flatMap(r => r.evidence)]);
  const grounded = validateClaims(claims, evidence) ? claims : claims.filter(c => validateClaims([c], evidence));
  send({ type: "answer", turnId: input.turnId, claims: grounded.length ? grounded : [{ text: "The requested check could not be completed. Please retry it.", evidenceIds: [] }] });
  memory.revision = revision;
  memory.lastResults = [...new Map([...memory.lastResults, ...completed.map(r => ({ id: r.id, kind: r.card.kind, profileHash: r.meta.profileHash }))].map(r => [r.id, r])).values()].slice(-40);
  // Do not replace old result hashes with the current one; they are previous-revision evidence.
  rememberTurn(input.sessionId, { plan, goals, memory, results: completed, message: input.message, planningComplete, preparationComplete });
  send({ type: "done", turnId: input.turnId, goals, memory });
  settled = true;
  return { state, memory, goals };
}
