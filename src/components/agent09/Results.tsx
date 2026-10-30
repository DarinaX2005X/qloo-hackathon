"use client";

import { ArrowRight, Map as MapIcon } from "lucide-react";
import type { AgentCardV2, AreaDecision, Constraint, ResultMeta } from "./types";
import { ruleKey } from "./Constraints";

const sameRules = (a: readonly Constraint[], b: readonly Constraint[]) => {
  const x = [...new Set(a.map(ruleKey))].sort().join("|");
  const y = [...new Set(b.map(ruleKey))].sort().join("|");
  return x === y;
};
import { VenuesCard } from "./Venues";
import { VisitCard } from "./Visit";
import { AreaRank } from "@/components/ui/Metric";
import { AddressCard, ComparisonCard, ExplanationCard, HomeMatchesCard } from "@/components/screens/decision";
import type { HomeView } from "@/components/screens/features";
import { useExplore } from "@/components/explore/store";
import { useGoTo } from "@/components/explore/nav";
import { useFeatures } from "@/components/screens/features";
import { cityName } from "@/components/ui/CityPicker";
import { joinAnd } from "@/lib/explain";

export type OpenHandlers = { onOpenVisit?: (card: Extract<AgentCardV2, { kind: "visit" }>, meta: ResultMeta) => void };

function OpenLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="mt-1.5 flex items-center gap-1.5 rounded-[9px] px-2 py-1 text-[13px] font-[600] text-you-deep transition-colors hover:bg-you-soft/60">
      <MapIcon size={14} /> {children} <ArrowRight size={13} />
    </button>
  );
}

/** Three areas with their rank, one reason and two places each; the number comes from the shared renderer. */
function AreasCard({ areas, title }: { areas: readonly AreaDecision[]; title: string }) {
  return (
    <div className="rounded-[18px] bg-paper-raised p-1.5 ring-1 ring-line" data-testid="areas-card">
      <p className="px-2 pb-1 pt-1.5 text-[12.5px] font-[560] text-ink-3">{title}</p>
      <ol>
        {areas.slice(0, 3).map((a) => (
          <li key={a.area.id} className="rounded-[12px] px-2 py-2">
            <div className="flex items-start gap-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-[620] tracking-[-0.01em] text-ink">
                  {a.area.geometryQuality === "approximate" ? `Around ${a.area.name}` : a.area.name}
                </p>
                {a.headline && <p className="text-[13px] leading-snug text-ink-2">{a.headline}</p>}
                {a.anchors.length > 0 && <p className="mt-0.5 truncate text-[12.5px] text-ink-3">{joinAnd(a.anchors.slice(0, 2).map((v) => v.place.name))}</p>}
                {a.recommendationStatus === "needs_checking" && <p className="mt-0.5 text-[12px] text-ink-3">Promising, the everyday places still need checking</p>}
              </div>
              <AreaRank metrics={a.metrics} size="sm" note={false} />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** One v2 result in the conversation, with a way to open it full size. */
export function ResultCard({
  card,
  meta,
  stale,
  handlers,
  sourceName,
}: {
  card: AgentCardV2;
  meta: ResultMeta;
  stale?: boolean;
  handlers?: OpenHandlers;
  /** the old neighborhood the agent compared against, from its memory */
  sourceName?: string | null;
}) {
  const features = useFeatures();
  const goTo = useGoTo();
  const ex = useExplore();
  const body = (() => {
    switch (card.kind) {
      case "areas":
        return (
          <>
            <AreasCard areas={card.areas} title={`Start with these areas in ${cityName(ex.state.city)}`} />
            <OpenLink
              onClick={() => {
                const first = card.areas[0]?.area.id;
                if (first && ex.analysis.data?.areas.some((a) => a.area.id === first)) ex.patch([{ op: "select_neighborhood", id: first }]);
                goTo("/explore");
              }}
            >
              Open on the map
            </OpenLink>
          </>
        );
      case "home":
        return (
          <>
            <HomeMatchesCard view={{ matches: card.matches, meta, sourceSignatureSummary: (card as { sourceSignatureSummary?: HomeView["sourceSignatureSummary"] }).sourceSignatureSummary }} compact />
            <OpenLink onClick={() => (features.showHome({ matches: card.matches, meta }, meta), goTo("/explore/home"))}>Open on the map</OpenLink>
          </>
        );
      case "address":
        return (
          <>
            <AddressCard view={{ ...card.result, meta }} compact selectedName={ex.selectedArea?.area.name ?? null} />
            <OpenLink onClick={() => (features.showSpot({ ...card.result, meta }, meta), goTo("/explore/address"))}>Open on the map</OpenLink>
          </>
        );
      case "comparison":
        return (
          <>
            <ComparisonCard view={{ ...card.result, meta }} compact sourceName={sourceName ?? null} />
            <p className="mt-1 px-1 text-[12.5px] text-ink-3">Your map stays on {cityName(ex.state.city)}.</p>
            <OpenLink onClick={() => (features.showComparison(card.result, meta), goTo("/explore/compare"))}>Open the comparison</OpenLink>
          </>
        );
      case "explanation":
        return (
          <>
            <ExplanationCard view={{ ablations: card.ablations, claims: card.claims, meta }} compact />
            <OpenLink onClick={() => (features.showDecides({ ablations: card.ablations, claims: card.claims, meta }, meta), goTo("/explore/why"))}>Open the explanation</OpenLink>
          </>
        );
      case "venues":
        return <VenuesCard venues={card.venues} compact />;
      case "visit":
        return (
          <VisitCard
            result={card.result}
            stale={stale}
            // the session rules sit above the composer; repeat them on the card only when this walk used different ones
            showRules={sameRules(card.result.constraints, (ex as { constraints?: Constraint[] }).constraints ?? []) === false}
            onOpen={handlers?.onOpenVisit ? () => handlers.onOpenVisit!(card, meta) : undefined}
          />
        );
    }
  })();
  return (
    <div data-testid="result-card" data-kind={card.kind} data-stale={stale ? "true" : undefined}>
      {stale && <p className="mb-1 text-[12px] font-[560] text-ink-3">From before your last change</p>}
      {meta.status === "partial" && card.kind !== "visit" && <p className="mb-1 text-[12px] font-[560] text-ink-3">Partial result</p>}
      {body}
    </div>
  );
}
