"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { Check, Play, Plus, Search, Upload } from "lucide-react";
import { cityName } from "@/components/ui/CityPicker";
import { emptyState, encodeState } from "@/lib/state";
import { useLanding } from "./LandingData";
import { LANDING } from "./scenes";

export const H2 = "text-[40px] font-[690] leading-[1.02] tracking-[-0.035em] sm:text-[56px]";

/** The tour film. Nothing loads until the visitor presses play, so it never slows the page. */
export function Demo() {
  const ref = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  return (
    <section id="demo" className="mx-auto max-w-[1360px] px-5 pt-16 md:px-10 md:pt-24">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <h2 className={H2}>Homing in 62 seconds</h2>
        <p className="max-w-[440px] text-[17px] leading-[1.55] text-ink-2">
          One taste, from the first chip to a plan, then any city in the world. Every map and number in the film is real Qloo data.
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
            aria-label="Play the Homing tour, 62 seconds"
            className="group absolute inset-0 grid place-items-center bg-[oklch(23%_0.02_40/0.16)] transition-colors hover:bg-[oklch(23%_0.02_40/0.04)]"
          >
            <span className="flex items-center gap-4 rounded-full bg-paper-raised p-2 shadow-[var(--shadow-overlay)] transition-transform duration-300 ease-out group-hover:scale-[1.04] sm:py-3 sm:pl-3 sm:pr-7">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-you text-white">
                <Play size={24} fill="currentColor" className="ml-1" />
              </span>
              <span className="hidden text-left sm:block">
                <span className="block text-[18px] font-[650] tracking-[-0.015em] text-ink">Play the tour</span>
                <span className="tnum block text-[14px] text-ink-3">1:02, with sound</span>
              </span>
            </span>
          </button>
        )}
      </div>
    </section>
  );
}

const TRY = ["Tokyo, Japan", "Reykjavík, Iceland", "Buenos Aires, Argentina", "Seoul, South Korea", "Almaty, Kazakhstan", "Austin, Texas"];

/** Any city: the same taste scored across five cities, from the comparison the app runs. */
export function AnyCity() {
  const { data } = useLanding();
  const loves = data?.hero?.loves ?? [];
  const cities = data?.cities?.filter((c) => !c.error) ?? [];
  const top = Math.max(0.0001, ...cities.map((c) => c.score));
  const open = (city: string) => `/explore?s=${encodeState({ ...emptyState(city), loves })}`;
  return (
    <section className="mx-auto max-w-[1360px] px-5 pb-24 md:px-10 md:pb-32">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <div className="lg:pt-6">
          <h2 className={H2}>Any city on the map</h2>
          <p className="mt-5 max-w-[460px] text-[18px] leading-[1.55] text-ink-2">
            Type any city in the world. Homing finds its centre, reads how your taste spreads around it and ranks its neighborhoods. Not sure where to go yet? Compare up to five cities for the same taste.
          </p>
          <p className="mt-6 text-[13px] font-[560] text-ink-3">Try this taste in</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {TRY.map((c) => (
              <Link
                key={c}
                href={open(c)}
                className="rounded-[11px] bg-paper-raised px-3 py-2 text-[14.5px] font-[560] text-ink shadow-[var(--shadow-rest)] ring-1 ring-line transition-colors hover:bg-you-soft hover:text-you-deep"
              >
                {cityName(c)}
              </Link>
            ))}
          </div>
        </div>
        <div className="rounded-[28px] bg-paper-raised p-5 shadow-[var(--shadow-raised)] ring-1 ring-line sm:p-7">
          <p className="text-[13px] font-[560] text-ink-3">Which city fits</p>
          <p className="mt-1 text-[19px] font-[620] leading-snug tracking-[-0.015em]">{LANDING.hero.loves.join(", ")}</p>
          {cities.length ? (
            <ol className="mt-5 space-y-2.5">
              {cities.map((c, i) => {
                const idx = Math.round((c.score / top) * 100);
                return (
                  <li key={c.city} className={`rounded-[16px] px-4 py-3 ${i === 0 ? "bg-you-soft" : "bg-paper-sunk/60"}`}>
                    <div className="flex items-center gap-3">
                      <span className={`tnum grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-[13px] font-[680] ${i === 0 ? "bg-you text-white" : "bg-paper-raised text-ink-2"}`}>
                        {i + 1}
                      </span>
                      <span className="w-[120px] shrink-0 text-[17px] font-[640] tracking-[-0.015em] sm:w-[150px]">{cityName(c.city)}</span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-paper-raised">
                        <motion.span
                          className="block h-full rounded-full bg-you"
                          initial={{ width: 0 }}
                          whileInView={{ width: `${idx}%` }}
                          viewport={{ once: true, margin: "-60px" }}
                          transition={{ duration: 0.9, delay: 0.1 + i * 0.08, ease: [0.2, 0.8, 0.2, 1] }}
                        />
                      </span>
                      <span className="tnum w-10 text-right text-[18px] font-[660]">{idx}</span>
                    </div>
                    {c.topNeighborhood && (
                      <p className="ml-10 mt-1 text-[13.5px] text-ink-2">
                        Start in <b className="font-[600] text-ink">{c.topNeighborhood}</b>
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="mt-5 text-[15px] text-ink-2">Open the map and press Compare cities to score them live.</p>
          )}
          <p className="mt-4 text-[12.5px] leading-relaxed text-ink-3">
            Among the places Qloo picks for this taste in each city, how often they carry the atmosphere it prefers. The top city is 100.
          </p>
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
    title: "Must-haves and a budget",
    body: "Cozy, live music, free wifi or any place tag Qloo knows. Neighborhoods and places re-rank around what you can't do without.",
    ui: (
      <div className="space-y-2.5">
        <div className="flex flex-wrap gap-1.5">
          <Chip on>Cozy</Chip>
          <Chip on>Live music</Chip>
          <Chip>Free wifi</Chip>
        </div>
        <Segmented items={["Any", "$", "$$", "$$$"]} active={2} />
      </div>
    ),
  },
  {
    title: "A plan you can bend",
    body: "Set the pace and the hour your day starts. Swap any stop for the next best fit, or build the plan around places you saved.",
    ui: (
      <div className="w-full space-y-2">
        <Segmented items={["Relaxed", "Balanced", "Packed"]} active={2} />
        {[
          ["09:00", "Fábrica Coffee Roasters"],
          ["10:30", "Museu de São Roque"],
        ].map(([t, n]) => (
          <div key={n} className="flex items-center gap-3 text-[13.5px]">
            <b className="tnum w-11 font-[640]">{t}</b>
            <span className="flex-1 truncate font-[540]">{n}</span>
            <span className="rounded-[7px] bg-paper-sunk px-2 py-0.5 text-[12px] font-[600] text-ink-3">Swap</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    title: "Genres count too",
    body: "Type “jazz” or “k-pop” and Homing carries it with the artists who lead that genre, so the map still reads a real audience.",
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
    title: "Save, compare, decide",
    body: "Keep places in a shortlist, open any of them for hours and links, and put two neighborhoods side by side before you pick one.",
    ui: (
      <div className="w-full space-y-2 text-[13.5px]">
        {(
          [
            ["Mercês", 92, 61],
            ["Santa Catarina", 88, 74],
          ] as const
        ).map(([n, a, b]) => (
          <div key={n} className="flex items-center gap-2.5">
            <span className="w-[110px] truncate font-[600]">{n}</span>
            <span className="h-1.5 flex-1 rounded-full bg-paper-sunk">
              <span className="block h-full rounded-full bg-you" style={{ width: `${a}%` }} />
            </span>
            <span className="h-1.5 flex-1 rounded-full bg-paper-sunk">
              <span className="block h-full rounded-full bg-ink-3" style={{ width: `${b}%` }} />
            </span>
          </div>
        ))}
        <span className="inline-flex items-center gap-1.5 rounded-[9px] bg-you-soft px-2.5 py-1.5 text-[13px] font-[600] text-you-deep">
          <Plus size={13} /> Plan around these 3
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
  {
    title: "Click the terrain",
    body: "Every peak is a real part of the field. Click one and Homing opens the neighborhood around it, with what drives it and its best places.",
    ui: (
      <svg viewBox="0 0 220 74" className="h-[74px] w-full" aria-hidden>
        {[18, 30, 46, 62, 40, 52, 26, 34, 14].map((h, i) => (
          <rect key={i} x={14 + i * 22} y={70 - h} width="16" height={h} rx="3" fill={i === 3 ? "var(--you)" : "var(--you-soft)"} />
        ))}
        <circle cx="88" cy="4" r="4" fill="var(--ink)" />
      </svg>
    ),
  },
];

export function MakeItYours() {
  return (
    <section id="features" className="mx-auto max-w-[1360px] px-5 py-24 md:px-10 md:py-32">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <h2 className={`max-w-[640px] ${H2}`}>Then make it yours</h2>
        <p className="max-w-[440px] text-[17px] leading-[1.55] text-ink-2">The map is a start. Everything after it bends to how you actually live.</p>
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
