"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import type { ResolvedLove } from "@/shared/contracts";
import { LIMITS } from "@/shared/contracts";
import { TerrainMap } from "@/components/map/TerrainMap";
import { CityPicker, cityName } from "@/components/ui/CityPicker";
import { Button, Spinner } from "@/components/ui/primitives";
import { LogoMark } from "@/components/brand/Logo";
import { DOMAIN_NAME } from "@/components/explore/LoveChips";
import { emptyState, encodeState } from "@/lib/state";
import { resolveNames, useLiveField } from "./useLiveField";

const EXAMPLE = ["Radiohead", "Fleabag", "Wes Anderson", "Patagonia"];

export function Hero() {
  const router = useRouter();
  const [city, setCity] = useState("Lisbon");
  const [loves, setLoves] = useState<ResolvedLove[]>([]);
  const [pending, setPending] = useState<string[]>([]);
  const [text, setText] = useState("");
  const { field, hoods, loading, error } = useLiveField(city, loves);

  useEffect(() => {
    resolveNames(EXAMPLE).then((r) => setLoves(r.filter((l) => l.chosen)));
  }, []);

  const add = async (q: string) => {
    const v = q.trim();
    if (!v || loves.length >= LIMITS.loves || loves.some((l) => l.query.toLowerCase() === v.toLowerCase())) return;
    setPending((p) => [...p, v]);
    const [l] = await resolveNames([v]);
    setPending((p) => p.filter((x) => x !== v));
    setLoves((cur) => [...cur, l]);
  };

  const go = () => {
    const s = { ...emptyState(city), loves };
    router.push(`/explore?s=${encodeState(s)}`);
  };

  const top = hoods?.slice(0, 3) ?? [];
  const [heroPad, setHeroPad] = useState({ top: 120, bottom: 80, left: 40, right: 40 });
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 768px)").matches;
    setHeroPad(wide ? { top: 140, bottom: 90, left: Math.round(window.innerWidth * 0.44), right: 60 } : { top: 40, bottom: 40, left: 30, right: 30 });
  }, []);

  return (
    <section className="relative isolate overflow-hidden pb-6 md:min-h-[100svh] md:pb-0">
      <header className="mx-auto flex max-w-[1360px] items-center justify-between px-5 pt-5 md:px-10">
        <Link href="/" className="flex items-center gap-2" aria-label="Homing">
          <LogoMark size={30} />
          <span className="text-[23px] font-[680] tracking-[-0.03em]">homing</span>
        </Link>
        <nav className="flex items-center gap-1 rounded-[14px] bg-paper/85 p-1 text-[15px] shadow-[var(--shadow-rest)] ring-1 ring-line backdrop-blur">
          <a href="#how" className="hidden rounded-[10px] px-3 py-2 text-ink-2 hover:bg-paper-sunk hover:text-ink sm:block">
            How it works
          </a>
          <a href="https://github.com/DarinaX2005X/qloo-hackathon" className="rounded-[10px] px-3 py-2 text-ink-2 hover:bg-paper-sunk hover:text-ink">
            Code
          </a>
        </nav>
      </header>

      <div className="mx-auto grid max-w-[1360px] px-5 pt-10 md:px-10 md:pt-[9vh]">
        <div className="max-w-[540px]">
          <h1 className="text-[52px] font-[700] leading-[0.98] tracking-[-0.04em] text-ink sm:text-[76px] lg:text-[92px]">
            Find your part of{" "}
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={city}
                initial={{ opacity: 0, y: 18, rotateX: -50 }}
                animate={{ opacity: 1, y: 0, rotateX: 0 }}
                exit={{ opacity: 0, y: -18, rotateX: 50 }}
                transition={{ type: "spring", stiffness: 300, damping: 26 }}
                className="inline-block rounded-[14px] bg-you px-3 pb-1 text-white shadow-[var(--shadow-raised)]"
              >
                {cityName(city)}
              </motion.span>
            </AnimatePresence>
          </h1>
          <p className="mt-6 max-w-[470px] text-[18px] leading-[1.5] text-ink-2 sm:text-[19px]">
            Tell Homing a few things you love. It shows where people with your taste gather in a city, which neighborhood fits you and what to do there.
          </p>

          <div className="mt-8 rounded-[22px] bg-paper-raised/95 p-3 shadow-[var(--shadow-overlay)] ring-1 ring-line backdrop-blur">
            <div className="flex flex-wrap gap-1.5 p-1">
              <AnimatePresence initial={false}>
                {loves.map((l) => (
                  <motion.span
                    layout
                    key={l.query}
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.85 }}
                    className={`flex h-9 items-center gap-1.5 rounded-[10px] pl-1 pr-1 text-[14px] font-[560] ${l.chosen ? "bg-paper-sunk text-ink" : "bg-paper-sunk text-ink-3 line-through"}`}
                  >
                    {l.chosen?.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={l.chosen.image} alt="" className="h-7 w-7 rounded-[7px] object-cover" />
                    ) : (
                      <span className="grid h-7 w-7 place-items-center rounded-[7px] bg-you text-[12px] font-[650] text-white">{l.query[0]?.toUpperCase()}</span>
                    )}
                    <span className="pl-0.5">{l.chosen?.name ?? l.query}</span>
                    {l.chosen && <span className="text-[12px] font-[450] text-ink-3">{DOMAIN_NAME[l.chosen.domain]}</span>}
                    <button
                      aria-label={`Remove ${l.query}`}
                      onClick={() => setLoves((c) => c.filter((x) => x.query !== l.query))}
                      className="grid h-7 w-7 place-items-center rounded-[7px] text-ink-3 hover:bg-paper-raised hover:text-ink"
                    >
                      <X size={14} />
                    </button>
                  </motion.span>
                ))}
                {pending.map((p) => (
                  <motion.span key={`p${p}`} className="flex h-9 items-center gap-2 rounded-[10px] bg-paper-sunk px-3 text-[14px] text-ink-3">
                    <Spinner size={13} /> {p}
                  </motion.span>
                ))}
              </AnimatePresence>
              <input
                data-testid="hero-love-input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    void add(text);
                    setText("");
                  } else if (e.key === "Backspace" && !text && loves.length) setLoves((c) => c.slice(0, -1));
                }}
                placeholder={loves.length ? "Add your own" : "An artist, a show, a book"}
                aria-label="Add something you love"
                className="h-9 min-w-[140px] flex-1 bg-transparent px-2 text-[15px] outline-none placeholder:text-ink-3"
              />
            </div>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <CityPicker variant="hero" value={city} onChange={setCity} className="sm:w-[220px]" />
              <Button variant="primary" size="lg" className="w-full sm:w-auto sm:flex-1" onClick={go} disabled={!loves.some((l) => l.chosen)}>
                Map my taste
              </Button>
            </div>
          </div>

          <div className="mt-4 min-h-[48px] text-[14px] text-ink-2">
            {error ? (
              <p className="text-ink-2">The taste graph is slow to answer right now. Change a chip or the city to try again.</p>
            ) : top.length ? (
              <p>
                {loading && <Spinner size={12} className="mr-1.5 inline text-ink-3" />}
                For this taste, Homing starts you in <strong className="font-[620] text-ink">{top[0].name}</strong>
                {top[1] && (
                  <>
                    , then <strong className="font-[620] text-ink">{top[1].name}</strong>
                  </>
                )}
                {top[2] && (
                  <>
                    {" "}and <strong className="font-[620] text-ink">{top[2].name}</strong>
                  </>
                )}
                .
              </p>
            ) : (
              <p className="flex items-center gap-2 text-ink-3">
                <Spinner size={12} /> Reading the taste graph for {cityName(city)}
              </p>
            )}
          </div>
        </div>
      </div>
      {/* the map: real taste field, bleeds off the right and bottom */}
      <div className="relative mx-5 mt-2 h-[440px] overflow-hidden rounded-[24px] shadow-[var(--shadow-raised)] ring-1 ring-line md:absolute md:inset-0 md:-z-10 md:m-0 md:h-auto md:overflow-visible md:rounded-none md:shadow-none md:ring-0">
        <TerrainMap field={field} neighborhoods={top} variant="hero" padding={heroPad} />
        <div className="pointer-events-none absolute inset-y-0 left-0 hidden w-[52%] bg-gradient-to-r from-paper from-30% via-paper/75 to-transparent md:block" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-40 bg-gradient-to-t from-paper to-transparent md:block" />
      </div>

    </section>
  );
}
