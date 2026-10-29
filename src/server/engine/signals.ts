import { activeLoves, type ResolvedLove, type TagRef } from "@/shared/contracts";
import type { QlooParams } from "@/server/qloo/client";

export function signals(loves: ResolvedLove[], refinements: TagRef[] = []): QlooParams {
  return {
    "signal.interests.entities": [...new Set(activeLoves(loves).map((love) => love.chosen.id))].sort().join(",") || undefined,
    "signal.interests.tags": [...new Set(refinements.map((tag) => tag.id))].sort().join(",") || undefined,
  };
}
