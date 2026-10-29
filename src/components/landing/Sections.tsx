"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, useInView } from "motion/react";
import type { ResolvedLove } from "@/shared/contracts";
import { TerrainMap } from "@/components/map/TerrainMap";
import { LogoMark } from "@/components/brand/Logo";
import { Button } from "@/components/ui/primitives";
import { emptyState, encodeState } from "@/lib/state";
import { resolveNames, useLiveField } from "./useLiveField";

/** Renders children only once scrolled near, so the page doesn't start five maps at load. */
function WhenNear({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const near = useInView(ref, { once: true, margin: "0px 0px -10% 0px" });
  return (
    <div ref={ref} className={className}>
      {near ? children : null}
    </div>
  );
}

function useResolved(names: string[]) {
  const [loves, setLoves] = useState<ResolvedLove[]>([]);
  useEffect(() => {
    resolveNames(names).then((r) => setLoves(r.filter((l) => l.chosen)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return loves;
}

function TasteCard({ title, names, city, ink }: { title: string; names: string[]; city: string; ink: "you" | "them" }) {
  const loves = useResolved(names);
  const { field, hoods } = useLiveField(city, ink === "you" ? loves : loves, null);
  const href = `/explore?s=${encodeState({ ...emptyState(city), loves })}`;
  return (
    <div className="overflow-hidden rounded-[28px] bg-paper-raised shadow-[var(--shadow-raised)] ring-1 ring-line">
      <div className="relative h-[340px] sm:h-[400px]">
        <TerrainMap field={field} neighborhoods={hoods?.slice(0, 3) ?? []} variant="hero" padding={{ top: 40, bottom: 30, left: 30, right: 30 }} />
      </div>
      <div className="p-5 sm:p-6">
        <p className="text-[13px] font-[560] text-ink-3">{title}</p>
        <p className="mt-1 text-[19px] font-[620] leading-snug tracking-[-0.015em] text-ink">{names.join(", ")}</p>
        <div className="mt-4 flex items-end justify-between gap-4">
          <ol className="space-y-1 text-[15px] text-ink-2">
            {(hoods ?? []).slice(0, 3).map((h) => (
              <li key={h.id} className="flex items-baseline gap-2">
                <span className="tnum w-4 font-[650] text-ink">{h.rank}</span>
                {h.name}
              </li>
            ))}
            {!hoods && <li className="text-ink-3">Ranking neighborhoods</li>}
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
          <h2 className="text-[40px] font-[690] leading-[1.02] tracking-[-0.035em] sm:text-[56px]">Same city, two different maps</h2>
          <p className="mt-5 max-w-[440px] text-[18px] leading-[1.55] text-ink-2">
            Neighborhood guides are written for an average visitor. Homing starts from what you love, so a quiet reader and a night owl moving to Berlin get different peaks, different streets and different first days.
          </p>
          <p className="mt-4 max-w-[440px] text-[16px] leading-[1.55] text-ink-3">
            Both maps below are live. They come from Qloo&apos;s taste graph, which connects what people like across music, film, books, brands and places to where those audiences actually spend time.
          </p>
        </div>
        <WhenNear className="grid gap-4 sm:grid-cols-2">
          <TasteCard title="A quiet reader" city="Berlin" ink="you" names={["Haruki Murakami", "Radiohead", "Fleabag"]} />
          <TasteCard title="A night owl" city="Berlin" ink="you" names={["Charli xcx", "Peggy Gou", "Euphoria"]} />
        </WhenNear>
      </div>
    </section>
  );
}

const STEPS = [
  {
    title: "You name what you love",
    body: "Type a few names or drop a screenshot of a playlist, watchlist or bookshelf. Each one is matched to an entity in Qloo's taste graph, so “Fleabag” means the show, with its audience.",
    call: "Qloo search",
  },
  {
    title: "The city becomes a taste field",
    body: "For each thing you love, Qloo returns how strongly its audience over-indexes across the city. Homing weighs them the way you tell it to and lifts the places where they overlap.",
    call: "Qloo insights, heatmap",
  },
  {
    title: "Popular or local is your call",
    body: "Every cell also knows how busy it is overall. The crowd dial separates where your people go from where everybody goes.",
    call: "Popularity per cell",
  },
  {
    title: "Neighborhoods, with reasons",
    body: "Cells are grouped into real neighborhoods from the places inside them. Each one says which of your loves pulls it up and what its cafés and bars feel like.",
    call: "Qloo places and tags",
  },
  {
    title: "Places and a plan you can use",
    body: "Inside a neighborhood Homing picks cafés, food, bars, culture and stays that fit you, then plans your first days around real opening hours and walking distance.",
    call: "Qloo places, hours",
  },
  {
    title: "Talk to it like a friend who knows the city",
    body: "“Less touristy.” “I work from cafés.” “Add my partner: techno and Succession.” The agent turns that into changes on the map and tells you what it did.",
    call: "Agent with Qloo tools",
  },
];

function How() {
  return (
    <section id="how" className="bg-ink text-paper">
      <div className="mx-auto max-w-[1360px] px-5 py-24 md:px-10 md:py-32">
        <h2 className="max-w-[760px] text-[40px] font-[690] leading-[1.02] tracking-[-0.035em] sm:text-[56px]">How Homing reads a city</h2>
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
  return <TwoInksBody />;
}

function TwoInksBody() {
  const you = useResolved(["Haruki Murakami", "Radiohead", "Wes Anderson"]);
  const them = useResolved(["Peggy Gou", "Succession", "Patagonia"]);
  const { field, hoods } = useLiveField("Lisbon", you, them);
  return (
    <section className="mx-auto max-w-[1360px] px-5 py-24 md:px-10 md:py-32">
      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-16">
        <WhenNear className="order-2 h-[440px] overflow-hidden rounded-[28px] bg-paper-raised shadow-[var(--shadow-raised)] ring-1 ring-line sm:h-[540px] lg:order-1">
          <TerrainMap field={field} mode="pair" neighborhoods={hoods?.slice(0, 3) ?? []} variant="hero" padding={{ top: 40, bottom: 40, left: 40, right: 40 }} />
        </WhenNear>
        <div className="order-1 lg:order-2">
          <h2 className="text-[40px] font-[690] leading-[1.02] tracking-[-0.035em] sm:text-[56px]">Moving with someone</h2>
          <p className="mt-5 text-[18px] leading-[1.55] text-ink-2">
            Add what they love and the map prints in two inks. Red is you, teal is them, and the dark overprint is where you both belong. Neighborhoods are ranked so the less happy of you two is as happy as possible, not by an average that leaves one person out.
          </p>
          <div className="mt-6 flex flex-wrap gap-2 text-[14px]">
            <span className="rounded-[9px] bg-you-soft px-2.5 py-1.5 font-[540] text-you-deep">Murakami, Radiohead, Wes Anderson</span>
            <span className="rounded-[9px] bg-them-soft px-2.5 py-1.5 font-[540] text-[oklch(42%_0.09_205)]">Peggy Gou, Succession, Patagonia</span>
          </div>
          {hoods?.[0] && (
            <p className="mt-5 text-[16px] text-ink-2">
              Their best shared start in Lisbon: <strong className="font-[620] text-ink">{hoods[0].name}</strong>.
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
        <h2 className="relative max-w-[760px] text-[40px] font-[700] leading-[1.02] tracking-[-0.035em] sm:text-[64px]">Your people are already somewhere in that city</h2>
        <div className="relative mt-8">
          <Link href="/explore">
            <Button variant="ink" size="lg">
              Map my taste
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
      <SameCity />
      <How />
      <WhenNear>
        <TwoInks />
      </WhenNear>
      <Closing />
    </>
  );
}
