"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { Check, Play, Search, Upload } from "lucide-react";
import { cityName } from "@/components/ui/CityPicker";
import { emptyState, encodeState } from "@/lib/state";
import { useLanding } from "./LandingData";
import { LANDING, namesText } from "./scenes";

export const H2 = "text-[40px] font-[690] leading-[1.02] tracking-[-0.035em] sm:text-[56px]";

/** The tour film. Nothing loads until the visitor presses play, so it never slows the page. */
export function Demo() {
  const ref = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  return (
    <section id="demo" className="mx-auto max-w-[1360px] px-5 pt-16 md:px-10 md:pt-24">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <h2 className={H2}>Homing in about a minute</h2>
        <p className="max-w-[440px] text-[17px] leading-[1.55] text-ink-2">
          One move from start to finish: what you love, three areas to start looking in, an address check and a short walk.
        </p>
      </div>
      <div className="relative mt-8 aspect-video overflow-hidden rounded-[28px] bg-[#211915] shadow-[var(--shadow-raised)] ring-1 ring-line">
        <video
          ref={ref}
          className="h-full w-full"
          src="/homing.mp4"
          poster="/homing-poster.jpg"
          preload="none"
          playsInline
          controls={started}
          onEnded={() => setStarted(false)}
        />
        {!started && (
          <button
            onClick={() => {
              setStarted(true);
              void ref.current?.play();
            }}
            aria-label="Play the Homing tour"
            className="group absolute inset-0 grid place-items-center bg-[oklch(23%_0.02_40/0.16)] transition-colors hover:bg-[oklch(23%_0.02_40/0.04)]"
          >
            <span className="flex items-center gap-4 rounded-full bg-paper-raised p-2 shadow-[var(--shadow-overlay)] transition-transform duration-300 ease-out group-hover:scale-[1.04] sm:py-3 sm:pl-3 sm:pr-7">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-you text-white">
                <Play size={24} fill="currentColor" className="ml-1" />
              </span>
              <span className="hidden text-left sm:block">
                <span className="block text-[18px] font-[650] tracking-[-0.015em] text-ink">Play the tour</span>
                <span className="block text-[14px] text-ink-3">About a minute, with sound</span>
              </span>
            </span>
          </button>
        )}
      </div>
    </section>
  );
}

const TRY = ["Berlin, Germany", "Amsterdam, Netherlands", "Montréal, Canada", "Tokyo, Japan", "Reykjavík, Iceland", "Buenos Aires, Argentina", "Seoul, South Korea", "Austin, Texas"];

/** Any city: the same taste opens in any city; each link computes that city's areas live. */
export function AnyCity() {
  const { data } = useLanding();
  const loves = data?.hero?.loves ?? [];
  const open = (city: string) => `/explore?s=${encodeState({ ...emptyState(city), loves })}`;
  return (
    <section className="mx-auto max-w-[1360px] px-5 pb-24 md:px-10 md:pb-32">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-end lg:gap-16">
        <div>
          <h2 className={H2}>Any city on the map</h2>
          <p className="mt-5 max-w-[460px] text-[18px] leading-[1.55] text-ink-2">
            Type any city. Homing finds its centre, marks out walkable areas around it and compares them for what you love. Where Qloo has less data, Homing says so instead of guessing.
          </p>
        </div>
        <div className="rounded-[28px] bg-paper-raised p-5 shadow-[var(--shadow-raised)] ring-1 ring-line sm:p-7">
          <p className="text-[13px] font-[560] text-ink-3">Try the example loves in another city</p>
          <p className="mt-1 text-[19px] font-[620] leading-snug tracking-[-0.015em]">{namesText(LANDING.hero.loves)}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {TRY.map((c) => (
              <Link
                key={c}
                href={open(c)}
                className="flex min-h-11 items-center rounded-[12px] bg-paper px-3.5 text-[15px] font-[560] text-ink shadow-[var(--shadow-rest)] ring-1 ring-line transition-colors hover:bg-you-soft hover:text-you-deep"
              >
                {cityName(c)}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Chip({ on, children }: { on?: boolean; children: React.ReactNode }) {
  return (
    <span className={`inline-flex h-8 items-center gap-1.5 rounded-[9px] px-2.5 text-[13.5px] font-[580] ${on ? "bg-you text-white" : "bg-paper-sunk text-ink"}`}>
      {on && <Check size={13} strokeWidth={3} />}
      {children}
    </span>
  );
}

function Segmented({ items, active }: { items: string[]; active: number }) {
  return (
    <span className="inline-flex rounded-[10px] bg-paper-sunk p-0.5 text-[13px] font-[600]">
      {items.map((x, i) => (
        <span key={x} className={`rounded-[8px] px-2.5 py-1 ${i === active ? "bg-paper-raised text-you-deep shadow-[var(--shadow-rest)]" : "text-ink-2"}`}>
          {x}
        </span>
      ))}
    </span>
  );
}

const FEATURES: { title: string; body: string; ui: React.ReactNode }[] = [
  {
    title: "Why this area",
    body: "See which places Qloo ties to your loves and what happens to the order if one love counts less. If nothing moves, Homing says the choice is stable.",
    ui: (
      <div className="w-full space-y-2 text-[13.5px]">
        <div className="flex items-center gap-2">
          <span className="rounded-[7px] bg-you-soft px-2 py-0.5 font-[600] text-you-deep">Radiohead</span>
          <span className="text-ink-3">ties to</span>
          <span className="font-[600]">a café in the area</span>
        </div>
        <div className="flex items-center gap-2 text-ink-2">
          <Segmented items={["A lot", "Some", "A little"]} active={1} />
          <span>order kept</span>
        </div>
      </div>
    ),
  },
  {
    title: "Check an address",
    body: "Paste the street of a flat you saw. Homing tells you which area it is in, how precise the location is and what is a short walk away.",
    ui: (
      <div className="w-full space-y-2">
        <div className="flex h-9 items-center gap-2 rounded-[10px] bg-paper-sunk px-3 text-[14px] text-ink-2">
          <Search size={14} /> Rua da Rosa 120
        </div>
        <span className="inline-flex h-7 items-center rounded-[8px] bg-paper-raised px-2.5 text-[12.5px] font-[580] text-ink-2 ring-1 ring-line">Street-level location</span>
      </div>
    ),
  },
  {
    title: "Try the area on foot",
    body: "A calm afternoon of three or four places, enough to test the coffee, the food and the culture. Swap any stop and the rest stay as they were.",
    ui: (
      <div className="w-full space-y-2">
        {[
          ["14:00", "Coffee"],
          ["15:10", "Late lunch"],
          ["16:30", "A small gallery"],
        ].map(([t, n]) => (
          <div key={t} className="flex items-center gap-3 text-[13.5px]">
            <b className="tnum w-11 font-[640]">{t}</b>
            <span className="flex-1 truncate font-[540]">{n}</span>
            <span className="rounded-[7px] bg-paper-sunk px-2 py-0.5 text-[12px] font-[600] text-ink-3">Swap</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    title: "Rules that stick",
    body: "No bars, no museums, a budget you mean. The rules stay with every search and plan, and a place with an unknown price is never passed off as within budget.",
    ui: (
      <div className="flex flex-wrap gap-1.5">
        <Chip on>No bars</Chip>
        <Chip on>Up to $$</Chip>
        <Chip>Vegetarian</Chip>
      </div>
    ),
  },
  {
    title: "Genres count too",
    body: "Type “jazz” or “k-pop” and Homing carries it with an artist that leads the genre, and tells you which one it used.",
    ui: (
      <div className="space-y-2">
        <div className="flex h-9 items-center gap-2 rounded-[10px] bg-paper-sunk px-3 text-[14px] text-ink-2">
          <Search size={14} /> jazz
        </div>
        <span className="inline-flex h-9 items-center gap-2 rounded-[10px] bg-paper-raised pl-1 pr-3 text-[14px] font-[560] ring-1 ring-line">
          <span className="grid h-7 w-7 place-items-center rounded-[7px] bg-ink text-[12px] font-[650] text-white">M</span>
          Miles Davis <span className="text-[12px] font-[450] text-ink-3">Music, for jazz</span>
        </span>
      </div>
    ),
  },
  {
    title: "Start from a screenshot",
    body: "Drop a screenshot of a playlist, a watchlist or a bookshelf. Homing reads the names and turns them into chips you can check.",
    ui: (
      <div className="flex items-center gap-3">
        <span className="grid h-[72px] w-[58px] shrink-0 place-items-center rounded-[10px] border-2 border-dashed border-line text-ink-3">
          <Upload size={18} />
        </span>
        <div className="flex flex-wrap gap-1.5">
          <Chip>Radiohead</Chip>
          <Chip>Fleabag</Chip>
          <Chip>Patagonia</Chip>
        </div>
      </div>
    ),
  },
];

export function MakeItYours() {
  return (
    <section id="features" className="mx-auto max-w-[1360px] px-5 py-24 md:px-10 md:py-32">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <h2 className={`max-w-[640px] ${H2}`}>After the shortlist</h2>
        <p className="max-w-[440px] text-[17px] leading-[1.55] text-ink-2">Each area opens into the next steps of a move: the reasons, a flat you saw and an afternoon to try it.</p>
      </div>
      <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f, i) => (
          <motion.li
            key={f.title}
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.5, delay: (i % 3) * 0.07, ease: [0.2, 0.8, 0.2, 1] }}
            className="flex flex-col rounded-[24px] bg-paper-raised p-5 shadow-[var(--shadow-rest)] ring-1 ring-line sm:p-6"
          >
            <div className="flex min-h-[116px] items-center rounded-[16px] bg-paper p-4 ring-1 ring-line">{f.ui}</div>
            <h3 className="mt-5 text-[20px] font-[640] leading-tight tracking-[-0.02em]">{f.title}</h3>
            <p className="mt-2 text-[15.5px] leading-[1.55] text-ink-2">{f.body}</p>
          </motion.li>
        ))}
      </ul>
    </section>
  );
}
