"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { UserPlus, X } from "lucide-react";
import type { ResolvedLove, TagRef } from "@/shared/contracts";
import { activeLoves } from "@/shared/contracts";
import { cityName } from "@/components/ui/CityPicker";
import { DOMAIN_NAME, LoveChip, LoveInput, PendingChip } from "./LoveChips";
import { useExplore } from "./store";
import { api } from "./api";
import { Button } from "@/components/ui/primitives";
import { TripControls } from "./TripControls";
import { RecentMaps } from "./RecentMaps";
import { domainOf, namesText, nameOf, type LandingName } from "@/components/landing/scenes";
import { resolveNames } from "@/components/landing/useLiveField";

export const PRESETS: { label: string; city: string; loves: LandingName[] }[] = [
  { label: "A rainy-day reader", city: "Lisbon", loves: ["Haruki Murakami", "Radiohead", "Fleabag", "Wes Anderson"] },
  { label: "A club kid", city: "Berlin", loves: ["Charli xcx", { name: "Peggy Gou", domain: "artist" }, { name: "Euphoria", domain: "tv_show" }, "Aphex Twin"] },
  { label: "Food first", city: "Mexico City", loves: ["The Bear", "Anthony Bourdain", "Chef's Table", "Bon Appétit"] },
];

function Chips({ who }: { who: "you" | "them" }) {
  const ex = useExplore();
  const loves = who === "you" ? ex.state.loves : ex.state.companion?.loves ?? [];
  const noGeo = new Set(ex.field.data?.signalsWithoutGeo ?? []);
  const pending = Object.keys(ex.pending)
    .filter((k) => k.startsWith(`${who}:`))
    .map((k) => k.slice(who.length + 1));
  return (
    <div className="flex flex-wrap gap-1.5">
      <AnimatePresence initial={false}>
        {loves.map((l: ResolvedLove) => (
          <LoveChip
            key={l.query}
            love={l}
            ink={who}
            noGeo={noGeo.has(l.query)}
            onRemove={() => ex.updateLove(who, l.query, () => null)}
            onWeight={(w) => ex.updateLove(who, l.query, (x) => ({ ...x, weight: w }))}
            onChoose={(id) => ex.updateLove(who, l.query, (x) => ({ ...x, chosen: x.candidates.find((c) => c.id === id) ?? x.chosen }))}
            onOpen={() => ex.loadCandidates(who, l.query)}
          />
        ))}
        {pending.map((q) => (
          <PendingChip key={`p-${q}`} query={q} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function TagRow({ title, tags, tone }: { title: string; tags?: TagRef[]; tone: "you" | "them" | "both" }) {
  return (
    tags && tags.length ? (
      <div>
        <p className="mb-1.5 text-[12px] font-[560] text-ink-3">{title}</p>
        <div className="flex flex-wrap gap-1">
          {tags.slice(0, 8).map((t) => (
            <span
              key={t.id}
              className="rounded-[7px] px-2 py-1 text-[12.5px] font-[520]"
              style={{
                background: tone === "you" ? "var(--you-soft)" : tone === "them" ? "var(--them-soft)" : "color-mix(in oklch, var(--both) 14%, var(--paper-raised))",
                color: tone === "you" ? "var(--you-deep)" : tone === "them" ? "oklch(42% 0.09 205)" : "var(--both)",
              }}
            >
              {t.name}
            </span>
          ))}
        </div>
      </div>
    ) : null
  );
}

function Fingerprint() {
  const { print, state } = useExplore();
  const pair = !!state.companion?.loves.length;
  const p = print.data;
  if (!p || (!p.you.length && !pair)) return null;
  return (
    <motion.div layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
      {pair ? (
        <>
          <TagRow title="You both lean" tags={p.shared} tone="both" />
          <TagRow title="Only you" tags={p.onlyYou} tone="you" />
          <TagRow title="Only them" tags={p.onlyThem} tone="them" />
        </>
      ) : (
        <TagRow title="Your taste reads as" tags={p.you} tone="you" />
      )}
    </motion.div>
  );
}

/** A typed name that matched more than one thing: two or three plain choices with their kind, instead of a silent guess. */
function WhichOne({ who }: { who: "you" | "them" }) {
  const ex = useExplore();
  const loves = who === "you" ? ex.state.loves : ex.state.companion?.loves ?? [];
  const open = loves.filter((l) => !l.chosen && l.candidates.length >= 2);
  if (!open.length) return null;
  return (
    <div className="mt-2 space-y-2">
      {open.map((l) => (
        <div key={l.query} className="rounded-[14px] bg-paper-sunk/70 p-2.5" data-testid="which-one">
          <p className="mb-1.5 px-1 text-[13px] text-ink-2">
            Which <strong className="font-[600] text-ink">{l.query}</strong> do you mean?
          </p>
          <div className="grid gap-1.5">
            {l.candidates.slice(0, 3).map((c) => (
              <button
                key={c.id + c.domain}
                onClick={() => ex.updateLove(who, l.query, (x) => ({ ...x, chosen: c }))}
                className="flex min-h-11 items-center gap-2.5 rounded-[11px] bg-paper-raised px-2 py-1.5 text-left ring-1 ring-line transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[var(--shadow-rest)]"
              >
                {c.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.image} alt="" className="h-8 w-8 shrink-0 rounded-[8px] object-cover" />
                ) : (
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-paper-sunk text-[13px] font-[650] text-ink-2">{c.name.slice(0, 1)}</span>
                )}
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-[580] text-ink">{c.name}</span>
                  <span className="block truncate text-[12px] text-ink-3">{[DOMAIN_NAME[c.domain], c.subtitle].filter(Boolean).join(", ")}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function TastePanel({ compact = false, onDone, footer }: { compact?: boolean; onDone?: () => void; footer?: React.ReactNode }) {
  const ex = useExplore();
  const [reading, setReading] = useState<"you" | "them" | null>(null);
  const [readErr, setReadErr] = useState<string | null>(null);
  const [showThem, setShowThem] = useState(!!ex.state.companion?.loves.length);
  const pair = showThem || !!ex.state.companion?.loves.length;

  const readImage = async (image: string, who: "you" | "them") => {
    setReading(who);
    setReadErr(null);
    try {
      const r = await api.intake({ image });
      const found = r.loves.filter((l) => l.chosen || l.candidates.length);
      if (!found.length) setReadErr("We couldn't read any titles or names in that image. Try a clearer screenshot.");
      ex.addResolved(found, who);
      if (r.city && who === "you" && !ex.state.loves.length) ex.patch([{ op: "set_city", city: r.city }]);
    } catch (e) {
      setReadErr((e as Error).message);
    } finally {
      setReading(null);
    }
  };

  const empty = !ex.state.loves.length && !Object.keys(ex.pending).length;

  // a new chip (an unknown taste with its note, a long name) pushes the input down; while the person is
  // typing, keep the input in view above the Ask bar instead of leaving it half under it
  const scroller = useRef<HTMLDivElement>(null);
  const inputBox = useRef<HTMLDivElement>(null);
  const pendingKey = Object.keys(ex.pending).join("|");
  useEffect(() => {
    const box = inputBox.current, sc = scroller.current;
    if (!box || !sc || !box.contains(document.activeElement)) return;
    const keep = () => {
      const gap = box.getBoundingClientRect().bottom + 16 - sc.getBoundingClientRect().bottom;
      if (gap > 0) sc.scrollBy({ top: gap, behavior: "smooth" });
    };
    // once now, and again after the chip has finished animating in
    const raf = requestAnimationFrame(keep);
    const later = setTimeout(keep, 420);
    return () => (cancelAnimationFrame(raf), clearTimeout(later));
  }, [ex.state.loves, pendingKey]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-taste-editor>
      <div ref={scroller} className="hm-scroll min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 pb-6 pt-5">
        <section>
          <h2 className="mb-1 text-[22px] font-[650] leading-tight tracking-[-0.02em]">What you love</h2>
          {!compact && (
            <p className="mb-3 text-[14px] leading-snug text-ink-2">
              Artists, films, shows, books, brands or places. Homing looks for the areas of {cityName(ex.state.city)} where they show up most.
            </p>
          )}
          <Chips who="you" />
          <WhichOne who="you" />
          <div ref={inputBox} className={ex.state.loves.length ? "mt-2" : ""}>
            <LoveInput
              count={ex.state.loves.length}
              onAdd={(q) => ex.addLove(q, "you")}
              onImage={(img) => readImage(img, "you")}
              reading={reading === "you"}
              placeholder={ex.state.loves.length ? "Add another" : "Radiohead, Fleabag, natural wine"}
              autoFocus={empty && !compact}
            />
          </div>
          {readErr && <p className="mt-2 text-[13px] text-err">{readErr}</p>}
          {empty && (
            <div className="mt-4">
              <p className="mb-2 text-[13px] font-[560] text-ink-3">Or start from an example</p>
              <div className="flex flex-col gap-1.5">
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => {
                      ex.patch([{ op: "set_city", city: p.city }]);
                      // a name with a domain hint ("Euphoria" the show) is resolved within that domain
                      p.loves.forEach((q) =>
                        domainOf(q) ? void resolveNames([q]).then((r) => ex.addResolved(r.filter((l) => l.chosen), "you")) : ex.addLove(nameOf(q), "you"),
                      );
                    }}
                    className="group flex items-center justify-between rounded-[12px] bg-paper-raised px-3.5 py-2.5 text-left ring-1 ring-line transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[var(--shadow-raised)] active:scale-[0.99]"
                  >
                    <span>
                      <span className="block text-[14.5px] font-[580] text-ink">{p.label}</span>
                      <span className="block text-[12.5px] text-ink-3">
                        {namesText(p.loves.slice(0, 3))} in {p.city}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              <RecentMaps />
            </div>
          )}
        </section>

        <Fingerprint />

        {ex.state.loves.length > 0 && <TripControls />}

        <section>
          <AnimatePresence initial={false} mode="popLayout">
            {pair ? (
              <motion.div key="them" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="rounded-[18px] bg-[color-mix(in_oklch,var(--them)_7%,var(--paper-raised))] p-3.5 ring-1 ring-[color-mix(in_oklch,var(--them)_25%,transparent)]">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-[16px] font-[620] tracking-[-0.01em]">What they love</h3>
                  <button
                    aria-label="Remove the second person"
                    onClick={() => {
                      ex.patch([{ op: "set_companion", loves: null }]);
                      setShowThem(false);
                    }}
                    className="grid h-7 w-7 place-items-center rounded-[8px] text-ink-3 hover:bg-paper-sunk hover:text-ink"
                  >
                    <X size={15} />
                  </button>
                </div>
                <Chips who="them" />
                <WhichOne who="them" />
                <div className={ex.state.companion?.loves.length ? "mt-2" : ""}>
                  <LoveInput
                    ink="them"
                    count={ex.state.companion?.loves.length ?? 0}
                    onAdd={(q) => ex.addLove(q, "them")}
                    onImage={(img) => readImage(img, "them")}
                    reading={reading === "them"}
                    placeholder="Their artists, shows, places"
                    autoFocus={showThem && !ex.state.companion?.loves.length}
                  />
                </div>
                <p className="mt-2 text-[12.5px] leading-snug text-ink-2">Neighborhoods are ranked so the less happy of you two is as happy as possible.</p>
              </motion.div>
            ) : (
              ex.state.loves.length > 0 && (
                <motion.div key="add" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <Button variant="secondary" size="sm" onClick={() => setShowThem(true)}>
                    <UserPlus size={15} strokeWidth={1.9} /> Add someone you&apos;re moving with
                  </Button>
                </motion.div>
              )
            )}
          </AnimatePresence>
        </section>
      </div>
      {footer}
      {onDone && (
        <div className="border-t border-line bg-paper-raised/80 px-4 pb-4 pt-3">
          <button
            onClick={onDone}
            data-testid="show-areas"
            disabled={!activeLoves(ex.state.loves).length}
            className="flex h-12 w-full items-center justify-center rounded-[14px] bg-you text-[16px] font-[600] text-white shadow-[var(--shadow-rest)] transition-[transform,background-color] hover:-translate-y-px hover:bg-you-deep active:scale-[0.98] disabled:opacity-45"
          >
            Show my areas
          </button>
        </div>
      )}
    </div>
  );
}
