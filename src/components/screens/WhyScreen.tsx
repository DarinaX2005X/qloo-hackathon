"use client";

import { useEffect, useMemo } from "react";
import { activeLoves } from "@/shared/contracts";
import { useExplore } from "@/components/explore/store";
import { Skeleton, Spinner } from "@/components/ui/primitives";
import { cityName } from "@/components/ui/CityPicker";
import { signalKey, useFeatures } from "./features";
import { DecidesCard, LoveFace, useLoveLook } from "./cards";
import { ErrorNote, ScreenPanel, ScreenTitle, useMapOverlay, useSelectNeighborhood } from "./shared";

export function WhyScreen() {
  const ex = useExplore();
  const f = useFeatures();
  const look = useLoveLook();
  const here = cityName(ex.state.city);
  const loves = activeLoves(ex.state.loves);
  const key = signalKey(ex.state);
  const select = useSelectNeighborhood();
  const d = f.decides;

  // load for the state as it is when the screen opens, and again whenever the loves or filters change
  const idle = !d.data && !d.loading && !d.error;
  useEffect(() => {
    if (!ex.hydrated || !loves.length || d.loading) return;
    if (idle || d.stale) void f.loadDecides();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ex.hydrated, key, idle, d.stale]);

  const topId = d.data?.neighborhoods[0]?.id;
  const top = ex.hoods.data?.find((n) => n.id === topId) ?? null;
  const focus = top?.center ?? null;
  const overlay = useMemo(() => (focus ? { focus } : null), [focus]);
  useMapOverlay(overlay);

  return (
    <ScreenPanel label="What decides" testId="why-screen">
      <ScreenTitle
        title="What decides"
        lead={<>Which of your loves the ranking in {here} really rests on, and whether the top pick holds up without any one of them.</>}
      />

      {loves.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {loves.map((l) => {
            const lk = look(l.query);
            return (
              <span key={l.query} className="flex h-8 items-center gap-1.5 rounded-[10px] bg-paper-sunk pl-1 pr-2.5 text-[13px] font-[560]">
                <LoveFace name={lk.name} image={lk.image} size={24} />
                {lk.name}
              </span>
            );
          })}
        </div>
      )}

      {!loves.length ? (
        <div className="rounded-[18px] bg-paper-sunk/70 p-4 text-[14px] leading-relaxed text-ink-2">
          Add a few things you love on the Map screen. With two or more, this screen shows which of them puts each neighborhood where it is.
        </div>
      ) : d.error && !d.loading ? (
        <ErrorNote message={d.error.message} onRetry={d.error.retryable ? () => void f.loadDecides() : undefined} />
      ) : !d.data ? (
        <div className="space-y-2.5">
          <p className="flex items-center gap-2 text-[13.5px] text-ink-2">
            <Spinner size={14} className="text-ink-3" /> Ranking {here} again without each of your {loves.length > 1 ? `${loves.length} loves` : "loves"}, one at a time.
          </p>
          <Skeleton className="h-[64px]" />
          <Skeleton className="h-[150px]" />
          <Skeleton className="h-[150px]" />
        </div>
      ) : (
        <div className={`transition-opacity ${d.loading ? "opacity-55" : ""}`}>
          {d.loading && (
            <p className="mb-2 flex items-center gap-2 text-[12.5px] text-ink-3">
              <Spinner size={12} /> Your taste changed, ranking again
            </p>
          )}
          <DecidesCard result={d.data} onPick={(id) => select(id)} />
        </div>
      )}

      {loves.length > 0 && (
        <p className="mt-5 text-[12.5px] leading-relaxed text-ink-3">
          How this works: for each love, Homing ranks {here} again as if you had never named it, with everything else the same. A neighborhood that falls without a love was standing on it; one that stays put would fit you anyway.
        </p>
      )}
    </ScreenPanel>
  );
}
