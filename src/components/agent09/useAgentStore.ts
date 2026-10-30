"use client";

import { useExplore, type ExploreStore } from "@/components/explore/store";
import type { HomingError } from "@/components/explore/api";
import type { Constraint, VisitResultV2 } from "./types";

/** The store facade F3 reads (F0 owns the store). Fields are optional while the facade lands, so screens degrade to the legacy path. */
export type VisitView = {
  data: VisitResultV2 | null;
  loading: boolean;
  error: HomingError | null;
  stale: boolean;
  areaIds: string[];
  from: "planner" | "assistant";
  legacy: boolean;
  excludeIds: string[];
  /** first stop, local hour 6..22 */
  startHour?: number;
};
type Facade = {
  revision: number;
  constraints: Constraint[];
  setConstraint: (c: Constraint) => void;
  removeConstraint: (id: string) => void;
  visit: VisitView;
  buildVisit: (areaId: string, opts?: { includeIds?: string[]; excludeIds?: string[]; startHour?: number }) => Promise<void>;
  openVisit: (result: VisitResultV2, areaIds: string[]) => void;
  swapVisitStop: (placeId: string) => Promise<void>;
  removeVisitStop: (placeId: string) => Promise<void>;
  retryGoal: (turnId: string, goalId: string) => Promise<void>;
  isTurnStale: (t: ExploreStore["chat"][number]) => boolean;
};

export type AgentStore = Omit<ExploreStore, keyof Facade> & Partial<Facade>;

export function useAgentStore(): AgentStore {
  return useExplore() as AgentStore;
}
