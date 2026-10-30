"use client";

// Owner: F0. The §8.4 facade: the actions a feature component may take on the decision, in one place, so screens
// get typed callbacks instead of editing the store for every action.

import { useCallback, useMemo } from "react";
import type { AgentCardV2, Constraint, ResultMeta } from "@/shared/contracts-09";
import { useFeatures } from "@/components/screens/features";
import { useExplore, type ChatTurn } from "./store";
import { useGoTo } from "./nav";

export type DecisionActions = {
  ask(message: string): Promise<void>;
  /** open an agent result (by its meta.analysisId, or `${turnId}:${index}` of its result event) on its full screen */
  openResult(id: string): void;
  selectArea(id: string): void;
  compareAreas(ids: [string, string]): Promise<void>;
  checkAddress(query: string): Promise<void>;
  buildVisit(areaId: string): Promise<void>;
  setConstraint(constraint: Constraint): void;
  removeConstraint(id: string): void;
  removePlace(id: string): void;
  retryGoal(turnId: string, goalId: string): Promise<void>;
};

/** Every v2 result of the conversation with a stable id: meta.analysisId, and `${turnId}:${index}` as a fallback. */
export function resultsOf(chat: ChatTurn[]): { ids: string[]; turnId: string; meta: ResultMeta; card: AgentCardV2 }[] {
  const out: { ids: string[]; turnId: string; meta: ResultMeta; card: AgentCardV2 }[] = [];
  for (const t of chat) {
    if (!t.turnId || !t.events) continue;
    let i = 0;
    for (const e of t.events)
      if (e.type === "result") {
        out.push({ ids: [e.meta.analysisId, `${t.turnId}:${i}`], turnId: t.turnId, meta: e.meta, card: e.card });
        i++;
      }
  }
  return out;
}

export function useDecisions(): DecisionActions {
  const ex = useExplore();
  const f = useFeatures();
  const goTo = useGoTo();
  const { askAgent, chat, patch, setCompare, buildVisit: build, openVisit, setConstraint, removeConstraint, removePlace, retryGoal, analysis } = ex;

  const openResult = useCallback(
    (id: string) => {
      const hit = [...resultsOf(chat)].reverse().find((r) => r.ids.includes(id));
      if (!hit) return;
      const { card, meta } = hit;
      switch (card.kind) {
        case "areas":
        case "venues":
          goTo("/explore");
          return;
        case "home":
          f.showHome({ matches: card.matches, meta }, meta);
          goTo("/explore/home");
          return;
        case "address":
          f.showSpot({ ...card.result, meta }, meta);
          goTo("/explore/address");
          return;
        case "explanation":
          f.showDecides({ claims: card.claims, ablations: card.ablations, meta }, meta);
          goTo("/explore/why");
          return;
        case "comparison":
          // the comparison opens on its own screen; the city on the map stays as it is
          f.showComparison(card.result, meta);
          goTo("/explore/compare");
          return;
        case "visit": {
          const areaIds = [...new Set(card.result.itinerary.days.map((d) => d.neighborhood))];
          openVisit(card.result, areaIds);
          goTo("/explore/trip");
          return;
        }
      }
    },
    [chat, f, goTo, openVisit],
  );

  const selectArea = useCallback(
    (id: string) => {
      if (analysis.data && !analysis.data.areas.some((a) => a.area.id === id)) return;
      patch([{ op: "select_neighborhood", id }]);
      goTo("/explore");
    },
    [analysis.data, patch, goTo],
  );

  const compareAreas = useCallback(
    async (ids: [string, string]) => {
      setCompare([...ids]);
      goTo("/explore/compare");
    },
    [setCompare, goTo],
  );

  const checkAddress = useCallback(
    async (query: string) => {
      goTo("/explore/address");
      await f.checkSpot({ query, ...(ex.state.neighborhood ? { areaId: ex.state.neighborhood } : {}) });
    },
    [f, goTo, ex.state.neighborhood],
  );

  const buildVisit = useCallback(
    async (areaId: string) => {
      goTo("/explore/trip");
      await build(areaId);
    },
    [build, goTo],
  );

  return useMemo(
    () => ({ ask: askAgent, openResult, selectArea, compareAreas, checkAddress, buildVisit, setConstraint, removeConstraint, removePlace, retryGoal }),
    [askAgent, openResult, selectArea, compareAreas, checkAddress, buildVisit, setConstraint, removeConstraint, removePlace, retryGoal],
  );
}
