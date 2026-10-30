"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import type { ResolvedLove } from "@/shared/contracts";
import { TerrainMap } from "@/components/map/TerrainMap";
import { toShortlist } from "@/components/map/areas";
import { LogoMark } from "@/components/brand/Logo";
import { Button } from "@/components/ui/primitives";
import { emptyState, encodeState } from "@/lib/state";
import { resolveNames, useLiveField } from "./useLiveField";
import { useLanding } from "./LandingData";
import { LANDING, namesText, type LandingName, type LandingScene } from "./scenes";
import { AnyCity, Demo, H2, MakeItYours } from "./More";

/** Loves for a landing scene: ready from the server, resolved here only as a fallback. */
function useResolved(names: LandingName[], prepared: LandingScene | null | undefined, pick: "loves" | "companion" = "loves") {
  const { restSettled: settled } = useLanding();
  const [loves, setLoves] = useState<ResolvedLove[]>([]);
  useEffect(() => {
    if (!settled) return;
    const ready = prepared?.[pick];
    if (ready?.length) setLoves(ready);
    else resolveNames(names).then((r) => setLoves(r.filter((l) => l.chosen)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled, prepared]);
  return loves;
}


/** Mounts its map only when the section comes near the screen: the first screen keeps a single WebGL canvas. */
function useNear<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setNear(true), { rootMargin: "300px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  return [ref, near] as const;
}

/** Calm paper placeholder where a map will be drawn. */
function MapSlot() {
  return <div className="h-full w-full bg-paper-sunk/60" aria-hidden />;
}

function TasteCard({ title, names, city, scene }: { title: string; names: LandingName[]; city: string; scene: "reader" | "owl" }) {
  const { data, restSettled } = useLanding();
  const [box, near] = useNear<HTMLDivElement>();
  const prepared = data?.[scene];
  const loves = useResolved(names, prepared);
  const { field, hoods } = useLiveField(city, near ? loves : [], null, true, prepared);
  const areas = useMemo(() => toShortlist(prepared?.areas?.length ? prepared.areas : hoods), [prepared, hoods]);
  const href = `/explore?s=${encodeState({ ...emptyState(city), loves })}`;
  return (
    <div className="overflow-hidden rounded-[28px] bg-paper-raised shadow-[var(--shadow-raised)] ring-1 ring-line">
      <div ref={box} className="relative h-[340px] sm:h-[400px]">
        {near ? <TerrainMap field={field} neighborhoods={areas} variant="hero" padding={{ top: 40, bottom: 30, left: 30, right: 30 }} /> : <MapSlot />}
      </div>
      <div className="p-5 sm:p-6">
        <p className="text-[13px] font-[560] text-ink-3">{title}</p>
        <p className="mt-1 text-[19px] font-[620] leading-snug tracking-[-0.015em] text-ink">{namesText(names)}</p>
        <div className="mt-4 flex items-end justify-between gap-4">
          <ol className="space-y-1 text-[15px] text-ink-2">
            {areas.slice(0, 3).map((h) => (
              <li key={h.id} className="flex items-baseline gap-2">
                <span className="tnum w-4 font-[650] text-ink">{h.rank}</span>
                {h.label}
              </li>
            ))}
            {!areas.length && <li className="text-ink-3">{restSettled ? "Open the map to compare its areas" : "Comparing areas"}</li>}
          </ol>
          <Link href={href} className="shrink-0 rounded-[11px] px-3 py-2 text-[14px] font-[580] text-you-deep transition-colors hover:bg-you-soft">
            Open this map
          </Link>
        </div>
      </div>
    </div>
  );
}

function SameCity() {
  return (
    <section className="mx-auto max-w-[1360px] px-5 py-24 md:px-10 md:py-32">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <div className="lg:pt-6">
          <h2 className={H2}>Same city, two different shortlists</h2>
          <p className="mt-5 max-w-[440px] text-[18px] leading-[1.55] text-ink-2">
            Neighborhood guides are written for an average newcomer. Homing starts from what you love, so a reader and a night owl moving to Berlin get different areas to start looking in and different places to check there.
          </p>
          <p className="mt-4 max-w-[440px] text-[16px] leading-[1.55] text-ink-3">
            Both examples use the same set of walkable areas in Berlin. Only the loves change. The signal comes from Qloo, which links what people like across music, film, books and brands to places in a city.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TasteCard title="A quiet reader" city={LANDING.reader.city} scene="reader" names={LANDING.reader.loves} />
          <TasteCard title="A night owl" city={LANDING.owl.city} scene="owl" names={LANDING.owl.loves} />
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  {
    title: "You say what you love, or where you lived",
    body: "Type a few artists, shows, books or brands, or name a neighborhood you loved living in. Each name is matched to one entity in Qloo, and when a name could mean two things Homing asks which one.",
    call: "Qloo search",
  },
  {
    title: "The new city is split into walkable areas",
    body: "Homing marks out the same set of areas for everyone: circles of about 650 metres around named places in the city centre. Your loves change their order and never the areas themselves.",
    call: "Fixed areas per city",
  },
  {
    title: "Your loves are read across those areas",
    body: "For each love, Qloo returns how strongly its signal shows up across the city. Homing combines them by the weights you set and puts the areas in order. Treat the order as a place to start looking.",
    call: "Qloo insights, heatmap",
  },
  {
    title: "Every area comes with real places",
    body: "Before an area is shown, Homing looks for cafés, food, bars and culture inside it that fit you, and drops places that do not fit the role, like a supermarket in a coffee slot.",
    call: "Qloo places",
  },
  {
    title: "Check an address, then walk it",
    body: "Type the street of a flat you saw and Homing tells you which area it falls in and what is near. Then try the area with a short walk of three or four places for one afternoon.",
    call: "Geocoder and Qloo places",
  },
  {
    title: "Ask in your own words",
    body: "“No bars, I work from cafés.” “Compare it with Berlin.” The assistant runs the same tools, checks the result against what you asked and tells you plainly when part of it could not be done.",
    call: "Agent with Qloo tools",
  },
];

function How() {
  return (
    <section id="how" className="bg-ink text-paper">
      <div className="mx-auto max-w-[1360px] px-5 py-24 md:px-10 md:py-32">
        <h2 className={`max-w-[760px] ${H2}`}>How Homing reads a city</h2>
        <ol className="mt-14 grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((s, i) => (
            <motion.li
              key={s.title}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.5, delay: (i % 3) * 0.08, ease: [0.2, 0.8, 0.2, 1] }}
              className="relative"
            >
              <span className="tnum mb-4 grid h-10 w-10 place-items-center rounded-[11px] bg-you text-[17px] font-[680] text-white">{i + 1}</span>
              <h3 className="text-[22px] font-[640] leading-tight tracking-[-0.02em]">{s.title}</h3>
              <p className="mt-2.5 text-[16px] leading-[1.6] text-[oklch(82%_0.015_70)]">{s.body}</p>
              <p className="mt-3 text-[13.5px] font-[550] text-[oklch(72%_0.12_35)]">{s.call}</p>
            </motion.li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function TwoInks() {
  const { data } = useLanding();
  const [box, near] = useNear<HTMLDivElement>();
  const you = useResolved(LANDING.pair.you, data?.pair);
  const them = useResolved(LANDING.pair.them, data?.pair, "companion");
  const { field, hoods } = useLiveField(LANDING.pair.city, near ? you : [], them, true, data?.pair);
  const areas = useMemo(() => toShortlist(data?.pair?.areas?.length ? data.pair.areas : hoods), [data?.pair, hoods]);
  return (
    <section className="mx-auto max-w-[1360px] px-5 py-24 md:px-10 md:py-32">
      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-16">
        <div ref={box} className="order-2 h-[440px] overflow-hidden rounded-[28px] bg-paper-raised shadow-[var(--shadow-raised)] ring-1 ring-line sm:h-[540px] lg:order-1">
          {near ? <TerrainMap field={field} mode="pair" neighborhoods={areas} variant="hero" padding={{ top: 40, bottom: 40, left: 40, right: 40 }} /> : <MapSlot />}
        </div>
        <div className="order-1 lg:order-2">
          <h2 className={H2}>Moving with someone</h2>
          <p className="mt-5 text-[18px] leading-[1.55] text-ink-2">
            Add what they love and the map prints in two inks: red for you, teal for them, and a dark overprint where both signals are strong. Areas are ordered by the weaker of your two results, so a strong match for one person cannot hide a poor fit for the other.
          </p>
          <div className="mt-6 flex flex-wrap gap-2 text-[14px]">
            <span className="rounded-[9px] bg-you-soft px-2.5 py-1.5 font-[540] text-you-deep">Murakami, Radiohead, Wes Anderson</span>
            <span className="rounded-[9px] bg-them-soft px-2.5 py-1.5 font-[540] text-[oklch(42%_0.09_205)]">Peggy Gou, Succession, Patagonia</span>
          </div>
          {areas[0] && (
            <p className="mt-5 text-[16px] text-ink-2">
              Their first shared area to check in Lisbon: <strong className="font-[620] text-ink">{areas[0].label}</strong>.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function Closing() {
  return (
    <section className="mx-auto max-w-[1360px] px-5 pb-20 md:px-10">
      <div className="relative overflow-hidden rounded-[32px] bg-you px-6 py-16 text-white sm:px-14 sm:py-20">
        <svg className="pointer-events-none absolute -right-24 -top-24 h-[520px] w-[520px] opacity-[0.16]" viewBox="0 0 64 64" fill="none" aria-hidden>
          <path d="M6.6 40.2C4.4 26.9 14.4 9.6 31.4 7.4c15.6-2 26.6 8.6 26 22.8-.6 15.4-12.4 26-27.6 26.2C17.4 56.5 8.4 50.8 6.6 40.2Z" stroke="white" strokeWidth="1.2" />
          <path d="M18.6 37.4c-.9-9.3 6.4-20.5 17-21.6 9.8-1 16 5.9 15.2 14.6-.8 9.2-7.8 15.3-16.6 15.1-8.2-.2-14.9-2.6-15.6-8.1Z" stroke="white" strokeWidth="1.2" />
          <path d="M30.4 31.9c-.3-4.7 3.4-9.6 8.3-9.9 4.5-.2 7.2 3.1 6.8 7.2-.4 4.3-3.6 7-7.8 6.9-3.9-.1-7.1-1.2-7.3-4.2Z" stroke="white" strokeWidth="1.2" />
        </svg>
        <h2 className="relative max-w-[760px] text-[40px] font-[700] leading-[1.02] tracking-[-0.035em] sm:text-[64px]">Know where to start looking before you book viewings</h2>
        <div className="relative mt-8">
          <Link href="/explore">
            <Button variant="ink" size="lg">
              Find my areas
            </Button>
          </Link>
        </div>
      </div>
      <footer className="flex flex-col gap-3 px-1 pt-10 text-[14px] text-ink-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="flex items-center gap-2 text-ink-2">
          <LogoMark size={20} /> Homing, built on Qloo&apos;s taste graph
        </span>
        <span className="flex gap-5">
          <a className="hover:text-ink" href="https://github.com/DarinaX2005X/qloo-hackathon">Source code</a>
          <a className="hover:text-ink" href="https://github.com/DarinaX2005X/qloo-hackathon/blob/main/LICENSE">MIT license</a>
          <a className="hover:text-ink" href="https://www.qloo.com">Qloo</a>
        </span>
      </footer>
    </section>
  );
}

export function Sections() {
  return (
    <>
      <Demo />
      <SameCity />
      <AnyCity />
      <How />
      <MakeItYours />
      <TwoInks />
      <Closing />
    </>
  );
}
