import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExploreState } from "../../src/shared/contracts";
import { applyPatches } from "../../src/shared/patches";
import { AgentRequestV2, AgentEventV2, emptySessionMemory, type SessionMemory } from "../../src/shared/contracts-09";
import { venueEligibility } from "../../src/server/engine/09/eligibility";

const directory = join(tmpdir(), "homing-stage09-private"); mkdirSync(directory, { recursive: true });
const profiles = JSON.parse(readFileSync(join(directory, "profiles.json"), "utf8"));
const base = process.env.BASE_URL ?? "http://localhost:3001";
const runLabel = process.env.RUN_LABEL?.replace(/[^a-zA-Z0-9_-]/g, "");
const selected = process.argv[2]?.split(",").map(Number) ?? [1, 2, 3, 4, 5];
const cases = [
  { id: 1, city: "Lisbon", profile: "reader", message: "I'm moving to Lisbon. I love Radiohead, Fleabag and Patagonia. I work from cafés. Where should I start looking?", follow: "Why that one? What if Radiohead matters less?" },
  { id: 2, city: "Lisbon", profile: "reader", message: "I loved living in Kreuzberg, Berlin. Where in Lisbon could feel familiar? Use my tastes too if the match is weak.", follow: "What happens if I ask for Alfama in Lisbon itself?" },
  { id: 3, city: "Lisbon", profile: "reader", message: "Would Lisbon or Reykjavík feel closer to Kreuzberg?", follow: "Compare Lisbon, Reykjavík and Atlantiszzzz to Kreuzberg." },
  { id: 4, city: "Lisbon", profile: "reader", message: "Check Rua da Rosa 120 for me. Then plan a relaxed afternoon nearby, no museums, no bars, and only places within $$ where you know the price.", follow: "Replace the second stop and keep the rest." },
  { id: 5, city: process.env.S5_CITY ?? "Berlin", profile: "techno", message: "Where can I go dancing? I want dark techno, no hotel bars and no adult clubs.", follow: "My partner doesn't like clubs. What could we do near our shortlist together?" },
];
const reports: unknown[] = [];
for (const scenario of cases.filter(c => selected.includes(c.id))) {
  // Match §9/Q exactly: dialogue 1 starts empty; 2–4 inherit only the three
  // explicit loves, not the separate Haruki Murakami reader reference profile.
  const dialogueLoves = profiles.find((p: { name: string }) => p.name === "indie outdoors").loves.filter((l: { query: string }) => !/wes anderson/i.test(l.query));
  let state = ExploreState.parse({ city: scenario.city, loves: scenario.id === 1 ? [] : scenario.id === 5 ? profiles.find((p: { name: string }) => p.name === scenario.profile).loves : dialogueLoves });
  let memory: SessionMemory = emptySessionMemory(31), revision = 31;
  const sessionId = `live09:${scenario.id}:${Date.now()}`;
  const history: { role: "user" | "assistant"; content: string }[] = [];
  let priorStopIds: string[] = [];
  for (const [index, message] of [scenario.message, ...(process.argv.includes("--follow") ? [scenario.follow] : [])].entries()) {
    const input = AgentRequestV2.parse({ responseVersion: 2, sessionId, turnId: `${sessionId}:${index}`, stateRevision: revision, state, memory, message, history });
    const started = performance.now(), timing: Record<string, number> = {}, events: AgentEventV2[] = [];
    const timeline: { atMs: number; type: AgentEventV2["type"]; stepId?: string; status?: string }[] = [];
    const response = await fetch(`${base}/api/agent`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": process.env.TEST_CLIENT_IP ?? "198.51.100.93" }, body: JSON.stringify(input), signal: AbortSignal.timeout(65_000) });
    timing.headers = performance.now() - started;
    if (response.status !== 200) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 120)}`);
    assert(response.body); let buffer = "", eventType = "";
    // Event names sit outside data; retain the individual SSE frames across arbitrary chunks.
    const reader = response.body.getReader(), decoder = new TextDecoder();
    while (true) {
      const chunk = await reader.read(); buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      let at: number;
      while ((at = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, at); buffer = buffer.slice(at + 2);
        eventType = frame.match(/^event:\s*(.+)$/m)?.[1] ?? "";
        const payload = frame.match(/^data:\s*(.+)$/m)?.[1]; if (!payload) continue;
        const event = AgentEventV2.parse({ ...JSON.parse(payload), type: eventType });
        assert.equal(event.turnId, input.turnId); events.push(event);
        timeline.push({ atMs: performance.now() - started, type: event.type, ...(event.type === "step" ? { stepId: event.stepId, status: event.status } : {}) });
        timing[event.type] ??= performance.now() - started;
        if (event.type === "step" && event.status === "running" && !event.stepId.endsWith(":understand")) timing.firstTool ??= performance.now() - started;
        if (event.type === "patch") { assert.equal(event.baseRevision, revision); state = applyPatches(state, event.ops); revision = event.nextRevision; if (event.constraints) memory.constraints = event.constraints; }
        if (event.type === "done") { memory = event.memory; revision = memory.revision; }
      }
      if (chunk.done) break;
    }
    const done = events.findLast(e => e.type === "done"); assert(done?.type === "done", "Every accepted live turn must settle its goals");
    assert(done.goals.every(g => g.status !== "pending" && g.status !== "running"));
    assert(done.goals.every(g => g.resultIds.length > 0 || g.unmet.length > 0), "No goal may end without a result or visible unmet reason");
    if (scenario.id === 5 && index === 1) assert(done.goals.some(g => g.kind === "find_venues"), "The partner follow-up must retain the venue goal");
    if (scenario.id === 3) assert.equal(state.city, scenario.city, "Comparison must not switch city");
    if (scenario.id === 5 && index === 0) assert.deepEqual(state.loves, input.state.loves, "Genre intent must remain temporary");
    if (scenario.id === 1 && index === 0) assert.equal(state.loves.length, 3, "Only the three explicitly named loves belong in the new profile");
    if (scenario.id === 2 && index === 0) {
      const homes = events.filter(e => e.type === "result" && e.card.kind === "home");
      const first = homes[0];
      assert(first?.type === "result" && first.card.kind === "home", "The original Home result must remain visible");
      if ((first.card.matches[0]?.similarity.value ?? 0) < 35) {
        assert(events.some(e => e.type === "replan" && e.nextAction.includes("35%")), "A requested weak-Home blend must have a visible replan");
        assert(homes.some(e => e.type === "result" && e.card.kind === "home" && e.card.matches[0]?.orderReason === "home_personal_blend"), "The blended Home result must be returned");
      }
    }
    for (const event of events.filter(e => e.type === "result")) {
      assert.equal(event.meta.stateRevision, revision, "Result must describe the committed revision");
      if (event.card.kind === "venues") for (const venue of event.card.venues) assert(venueEligibility(venue.place, venue.role, memory.constraints).allowed);
      if (event.card.kind === "visit") {
        assert.equal(event.card.result.audit.hardViolations.length, 0);
        for (const venue of Object.values(event.card.result.venueEvidence)) assert(venueEligibility(venue.place, venue.role, memory.constraints, { requireKnownBudget: true }).allowed);
        const ids = event.card.result.itinerary.days.flatMap(d => d.stops.map(s => s.place.id));
        for (const day of event.card.result.itinerary.days) {
          const names = day.stops.map(s => s.place.name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim());
          assert.equal(new Set(names).size, names.length, "A venue name may appear only once in a day");
          for (const stop of day.stops) assert(event.card.result.venueEvidence[stop.place.id]?.insideArea, "Every stop must stay within the selected area");
        }
        if (scenario.id === 4 && index === 1 && priorStopIds.length > 1) {
          assert(!ids.includes(priorStopIds[1]), "The replaced stop must be excluded");
          assert(priorStopIds.filter((_, i) => i !== 1).every(id => ids.includes(id)), "The other stops must be retained");
        }
        priorStopIds = ids;
      }
    }
    const claims = events.filter(e => e.type === "answer").flatMap(e => e.claims);
    const summary = { scenario: scenario.id, turn: index, message, timing, totalMs: performance.now() - started, goals: done.goals, cards: events.filter(e => e.type === "result").map(e => ({ kind: e.card.kind, method: e.meta.methodVersion, status: e.meta.status })), replans: events.filter(e => e.type === "replan"), constraints: done.memory.constraints, city: state.city, claims };
    console.log(JSON.stringify(summary)); reports.push({ input, summary, timeline, events });
    history.push({ role: "user", content: message }, { role: "assistant", content: claims.map(c => c.text).join(" ").slice(0, 6000) });
    writeFileSync(join(directory, `${runLabel ?? `b4-http-${selected.join("-")}${process.env.S5_CITY ? `-${process.env.S5_CITY}` : ""}`}.json`), JSON.stringify(reports, null, 2));
  }
}
