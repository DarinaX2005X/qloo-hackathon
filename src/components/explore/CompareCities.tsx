"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { activeLoves } from "@/shared/contracts";
import { useExplore } from "./store";
import { Button, Segmented, Skeleton, Spinner } from "@/components/ui/primitives";
import { CityPicker, cityName } from "@/components/ui/CityPicker";
import { useFeatures } from "@/components/screens/features";
import { ComparisonCard } from "@/components/screens/decision";
import { ErrorNote } from "@/components/screens/shared";

const MAX = 3;
type Basis = "taste" | "home";

/**
 * Two (at most three) cities checked with one method, side by side. The map keeps its city: opening a city's map
 * is a separate, explicit action. Each city has its own result or its own error.
 */
export function CityCompare({ onOpenCity }: { onOpenCity: (city: string) => void }) {
  const ex = useExplore();
  const f = useFeatures();
  const c = f.cities;
  const here = cityName(ex.state.city);
  const [list, setList] = useState<string[]>(() => (c.asked.length ? c.asked : [here, here.toLowerCase() === "berlin" ? "Lisbon" : "Berlin"]));
  const [adding, setAdding] = useState("");
  const [basis, setBasis] = useState<Basis>(() => (c.source ? "home" : f.home.request ? "home" : "taste"));
  const [srcCity, setSrcCity] = useState(() => c.source?.city ?? f.home.request?.city ?? "Berlin");
  const [srcHood, setSrcHood] = useState(() => c.source?.neighborhood ?? f.home.request?.neighborhood ?? "Kreuzberg");
  const loves = activeLoves(ex.state.loves);
  const canRun = list.length >= 2 && !c.loading && (basis === "home" ? !!srcCity.trim() && !!srcHood.trim() : loves.length > 0);
  const run = () => void f.compareCities(list, basis === "home" ? { city: srcCity.trim(), neighborhood: srcHood.trim() } : null);

  return (
    <section aria-label="Compare cities">
      <h2 className="text-[22px] font-[660] leading-tight tracking-[-0.02em]">Two cities, one method</h2>
      <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2">
        Check the same old neighborhood or the same taste in two cities. The map stays on {here} until you open another city.
      </p>

      <div className="mt-4">
        <Segmented
          size="sm"
          label="Compare by"
          value={basis}
          onChange={setBasis}
          options={[
            { value: "home", label: "Closeness to an old neighborhood" },
            { value: "taste", label: "Your loves" },
          ]}
        />
      </div>

      {basis === "home" && (
        <div className="mt-2.5 grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-2">
          <label className="block">
            <span className="mb-1 block text-[12.5px] font-[560] text-ink-3">City you lived in</span>
            <CityPicker value={srcCity} onChange={setSrcCity} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12.5px] font-[560] text-ink-3">Neighborhood</span>
            <input
              data-testid="compare-source-hood"
              value={srcHood}
              onChange={(e) => setSrcHood(e.target.value)}
              maxLength={80}
              autoComplete="off"
              spellCheck={false}
              className="h-10 w-full rounded-[12px] bg-paper-raised px-3 text-[15px] font-[560] text-ink ring-1 ring-line outline-none focus:ring-2 focus:ring-you"
            />
          </label>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {list.map((city) => (
          <span key={city} className="flex h-10 items-center gap-1 rounded-[11px] bg-paper-sunk pl-3 pr-1 text-[14.5px] font-[560]">
            {cityName(city)}
            <button
              aria-label={`Remove ${city}`}
              onClick={() => setList((l) => l.filter((x) => x !== city))}
              className="grid h-9 w-9 place-items-center rounded-[8px] text-ink-3 hover:bg-paper-raised hover:text-ink"
            >
              <X size={14} />
            </button>
          </span>
        ))}
        {list.length < MAX && (
          <div className="flex items-center gap-1.5">
            <CityPicker
              key={list.length}
              className="w-[190px]"
              value={adding}
              onChange={(city) => {
                setList((l) => (l.some((x) => x.toLowerCase() === city.toLowerCase()) ? l : [...l, city]));
                setAdding("");
              }}
            />
            <Plus size={16} className="text-ink-3" />
          </div>
        )}
        <Button data-testid="compare-cities" variant="primary" size="md" className="ml-auto" disabled={!canRun} onClick={run}>
          {c.loading ? <Spinner size={15} /> : null}
          {c.loading ? "Checking" : "Compare"}
        </Button>
      </div>
      {basis === "taste" && !loves.length && (
        <p className="mt-2.5 text-[13.5px] text-ink-2">Add a few things you love on the Map screen first, or compare by an old neighborhood.</p>
      )}

      <div className="mt-5">
        {c.error && <ErrorNote message={c.error.message} onRetry={c.error.retryable ? run : undefined} />}
        {c.loading && !c.data && (
          <div className="space-y-2.5">
            <p className="text-[13.5px] text-ink-2">Checking {list.map(cityName).join(" and ")} with the same method. A city seen for the first time takes a few seconds.</p>
            <Skeleton className="h-[140px]" />
            <Skeleton className="h-[140px]" />
          </div>
        )}
        {c.data && (
          <div data-testid="comparison-result" data-stale={c.stale || undefined}>
            {c.stale && !c.loading && (
              <div
                data-testid="comparison-stale"
                className="mb-2.5 flex flex-wrap items-center justify-between gap-2 rounded-[12px] bg-paper-sunk px-3 py-2 text-[13px] text-ink-2"
              >
                <span>From before your last change.</span>
                <button onClick={run} disabled={!canRun} className="min-h-8 font-[600] text-you-deep hover:underline disabled:text-ink-3">
                  Compare again
                </button>
              </div>
            )}
            <div className={`transition-opacity ${c.loading || c.stale ? "opacity-55" : ""}`}>
              <ComparisonCard view={c.data} onOpenCity={onOpenCity} sourceName={c.source?.neighborhood ?? null} />
              <p className="mt-3 text-[12.5px] leading-relaxed text-ink-3">
                {c.source
                  ? `Each city's number is the middle of its three closest areas to ${c.source.neighborhood}, on the same 0 to 100 scale. Differences of a few points are not a real difference.`
                  : c.data.method === "personal_area_rank_v1"
                    ? "Each city's areas are ranked for your loves on their own. #1 means first among that city's areas; the ranks of two cities are not compared with each other."
                    : "Each city is checked for your loves with the same method. The number is an overlap index from 0 to 100, not a chance that you will like living there."}
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
