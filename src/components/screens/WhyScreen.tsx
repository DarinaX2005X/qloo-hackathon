"use client";

import { useEffect, useMemo } from "react";
import { activeLoves } from "@/shared/contracts";
import { useExplore } from "@/components/explore/store";
import { PlaceDrawer } from "@/components/explore/PlaceDrawer";
import { Skeleton, Spinner } from "@/components/ui/primitives";
import { AreaRank, MetricNote } from "@/components/ui/Metric";
import { cityName } from "@/components/ui/CityPicker";
import { signalKey, useFeatures } from "./features";
import { AblationRows, AreaProof } from "./decision";
import { VenueRow, areaName, areaScale } from "./venue";
import { ErrorNote, ScreenPanel, ScreenTitle, platesOf, useAreaActions, useAreas, useMapOverlay } from "./shared";

/**
 * Why this area (§10.1, §13.3): the selected area (or the first one) with its proof, its everyday places,
 * and what changes the choice when one love is taken away, from the same computed ranking.
 */
export function WhyScreen() {
  const ex = useExplore();
  const f = useFeatures();
  const actions = useAreaActions();
  const here = cityName(ex.state.city);
  const loves = activeLoves(ex.state.loves);
  const key = signalKey(ex.state);
  const areas = useAreas();
  const area = ex.selectedArea ?? areas[0] ?? null;
  const d = f.decides;

  // load for the state as it is when the screen opens, and again whenever the loves change
  const idle = !d.data && !d.loading && !d.error;
  useEffect(() => {
    if (!ex.hydrated || !loves.length || d.loading) return;
    if (idle || d.stale) void f.loadDecides(area?.area.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ex.hydrated, key, idle, d.stale]);

  const rows = useMemo(() => (area && d.data ? d.data.ablations.filter((a) => a.areaId === area.area.id) : []), [area, d.data]);
  // the explanation may cover only the top areas; ask again for the one the person picked
  useEffect(() => {
    if (!area || !d.data || d.loading || rows.length) return;
    if (d.areaId !== area.area.id && d.data.ablations.length) void f.loadDecides(area.area.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area?.area.id, d.data]);

  const overlay = useMemo(
    () =>
      area
        ? {
            neighborhoods: platesOf([area]),
            focus: area.area.center,
            places: area.anchors.map((v) => v.place),
          }
        : null,
    [area],
  );
  useMapOverlay(overlay);

  return (
    <ScreenPanel label="Why this area" testId="why-screen">
      {ex.openPlace ? (
        <PlaceDrawer key={`p-${ex.openPlace.id}`} place={ex.openPlace} />
      ) : (
        <>
          <ScreenTitle
            title="Why this area"
            lead={<>What in your taste puts this area where it is in {here}, which places back it up, and whether the choice holds without any one of your loves.</>}
          />

          {!loves.length ? (
            <div className="rounded-[18px] bg-paper-sunk/70 p-4 text-[14px] leading-relaxed text-ink-2">
              Add a few things you love on the Map screen. With two or more, this screen shows which of them the choice rests on.
            </div>
          ) : !area ? (
            ex.analysis.loading ? (
              <div className="space-y-2.5">
                <Skeleton className="h-[90px]" />
                <Skeleton className="h-[150px]" />
              </div>
            ) : (
              <p className="text-[14px] text-ink-2">No areas checked in {here} yet.</p>
            )
          ) : (
            <>
              <section
                data-testid="why-area"
                className="rounded-[20px] bg-[color-mix(in_oklch,var(--you)_5%,var(--paper-raised))] p-4 ring-1 ring-[color-mix(in_oklch,var(--you)_22%,transparent)]"
              >
                {/* the name wraps to two lines and the rank drops below it when the card is too narrow for both (phones) */}
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                  <div className="min-w-0 flex-1 basis-[180px]">
                    <h3 data-testid="why-area-name" className="line-clamp-2 text-[21px] font-[660] leading-tight tracking-[-0.02em] [overflow-wrap:anywhere]">{areaName(area.area)}</h3>
                    <p className="mt-0.5 text-[12.5px] text-ink-3">{areaScale(area.area)}</p>
                  </div>
                  <AreaRank metrics={area.metrics} size="md" />
                </div>
                <div className="mt-3">
                  <AreaProof area={area} ablations={d.data?.ablations} actions={actions} />
                </div>
              </section>

              {area.anchors.length > 0 && (
                <section className="mt-5">
                  <h3 className="mb-1 text-[15px] font-[620] tracking-[-0.01em]">Your everyday places here</h3>
                  <ul className="-mx-2 space-y-0.5">
                    {area.anchors.slice(0, 4).map((v) => (
                      <li key={v.venueKey}>
                        <VenueRow v={v} onOpen={() => ex.setOpenPlace(v.place)} />
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section className="mt-5">
                <h3 className="text-[15px] font-[620] tracking-[-0.01em]">What changes the choice</h3>
                <p className="mb-2 mt-0.5 text-[12.5px] leading-snug text-ink-3">The same ranking computed again without each love, one at a time. Nothing else changes.</p>
                {d.error && !d.loading ? (
                  <ErrorNote message={d.error.message} onRetry={d.error.retryable ? () => void f.loadDecides(area.area.id) : undefined} />
                ) : !d.data ? (
                  <p className="flex items-center gap-2 text-[13.5px] text-ink-2">
                    <Spinner size={14} className="text-ink-3" /> Ranking {here} again without each of your loves.
                  </p>
                ) : rows.length ? (
                  <div className={`transition-opacity ${d.loading ? "opacity-55" : ""}`}>
                    <AblationRows rows={rows} />
                  </div>
                ) : loves.length < 2 ? (
                  <p className="text-[13.5px] text-ink-2">With one love there is nothing to take away. Add another to see what the choice rests on.</p>
                ) : (
                  <p className="text-[13.5px] text-ink-2">{d.loading ? "Checking this area." : "No result for this area yet."}</p>
                )}
              </section>
              <MetricNote className="mt-4" city={here} candidateCount={area.metrics.candidateCount} />
            </>
          )}
        </>
      )}
    </ScreenPanel>
  );
}
