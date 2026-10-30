"use client";

// The cards other packages import. The stage-09 cards live in ./decision; the three old names below only
// adapt a stage-08 payload (an old assistant turn) into the same v2 cards, so no old label is ever drawn.
import type { DecidesResult, HomeResult, SpotResult } from "@/shared/contracts";
import { useExplore } from "@/components/explore/store";
import { decidesFromLegacy, homeFromLegacy, spotFromLegacy } from "./api09";
import { AddressCard, ExplanationCard, HomeMatchesCard } from "./decision";

export { AddressCard, AreaProof, ComparisonCard, ExplanationCard, HomeMatchesCard, AblationRows } from "./decision";
export { VenueRow, areaName, areaScale } from "./venue";

/** @deprecated an old Home payload, drawn as the v2 Home card. Use HomeMatchesCard. */
export function HomeCard({ result, compact = false }: { result: HomeResult; compact?: boolean }) {
  const ex = useExplore();
  return <HomeMatchesCard view={homeFromLegacy(result, ex.state, ex.revision, 0)} compact={compact} />;
}

/** @deprecated an old address payload, drawn as the v2 address card. Use AddressCard. */
export function SpotCard({ result, compact = false }: { result: SpotResult; compact?: boolean }) {
  const ex = useExplore();
  return <AddressCard view={spotFromLegacy(result, ex.state, ex.revision)} compact={compact} />;
}

/** @deprecated an old explanation payload, drawn as the v2 explanation card. Use ExplanationCard. */
export function DecidesCard({ result, compact = false }: { result: DecidesResult; compact?: boolean; onPick?: (id: string) => void }) {
  const ex = useExplore();
  return <ExplanationCard view={decidesFromLegacy(result, ex.state, ex.revision)} compact={compact} />;
}
