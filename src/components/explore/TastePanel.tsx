"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { UserPlus, X } from "lucide-react";
import type { ResolvedLove, TagRef } from "@/shared/contracts";
import { LoveChip, LoveInput, PendingChip } from "./LoveChips";
import { useExplore } from "./store";
import { api } from "./api";
import { Button } from "@/components/ui/primitives";
import { AgentChat } from "./AgentChat";

export const PRESETS: { label: string; city: string; loves: string[] }[] = [
  { label: "A rainy-day reader", city: "Lisbon", loves: ["Haruki Murakami", "Radiohead", "Fleabag", "Wes Anderson"] },
  { label: "A club kid", city: "Berlin", loves: ["Charli xcx", "Peggy Gou", "Euphoria", "Aphex Twin"] },
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
          />
        ))}
        {pending.map((q) => (
          <PendingChip key={`p-${q}`} query={q} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function Fingerprint() {
  const { print, state } = useExplore();
  const pair = !!state.companion?.loves.length;
  const p = print.data;
  if (!p || (!p.you.length && !pair)) return null;
  const Row = ({ title, tags, tone }: { title: string; tags?: TagRef[]; tone: "you" | "them" | "both" }) =>
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
    ) : null;
  return (
    <motion.div layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
      {pair ? (
        <>
          <Row title="You both lean" tags={p.shared} tone="both" />
          <Row title="Only you" tags={p.onlyYou} tone="you" />
          <Row title="Only them" tags={p.onlyThem} tone="them" />
        </>
      ) : (
        <Row title="Your taste reads as" tags={p.you} tone="you" />
      )}
    </motion.div>
  );
}

export function TastePanel({ compact = false }: { compact?: boolean }) {
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="hm-scroll min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 pb-4 pt-5">
        <section>
          <h2 className="mb-1 text-[22px] font-[650] leading-tight tracking-[-0.02em]">What you love</h2>
          {!compact && <p className="mb-3 text-[14px] leading-snug text-ink-2">Artists, films, shows, books, brands or places. Mix them, that&apos;s the point.</p>}
          <Chips who="you" />
          <div className={ex.state.loves.length ? "mt-2" : ""}>
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
                      p.loves.forEach((q) => ex.addLove(q, "you"));
                    }}
                    className="group flex items-center justify-between rounded-[12px] bg-paper-raised px-3.5 py-2.5 text-left ring-1 ring-line transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[var(--shadow-raised)] active:scale-[0.99]"
                  >
                    <span>
                      <span className="block text-[14.5px] font-[580] text-ink">{p.label}</span>
                      <span className="block text-[12.5px] text-ink-3">
                        {p.loves.slice(0, 3).join(", ")} in {p.city}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <Fingerprint />

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
      {ex.state.loves.length > 0 && <AgentChat />}
    </div>
  );
}
