"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Coffee, House, Landmark, MapPin, Mic2, Music, Sparkles, UtensilsCrossed, Wine, X, type LucideIcon } from "lucide-react";
import type { ResolvedLove } from "@/shared/contracts";
import { LIMITS } from "@/shared/contracts";
import { TerrainMap } from "@/components/map/TerrainMap";
import { toShortlist, type ShortlistArea } from "@/components/map/areas";
import { CityPicker, cityName } from "@/components/ui/CityPicker";
import { Button, Segmented, Spinner } from "@/components/ui/primitives";
import { LogoMark } from "@/components/brand/Logo";
import { DOMAIN_NAME } from "@/components/explore/LoveChips";
import { emptyState, encodeState } from "@/lib/state";
import { resolveNames } from "./useLiveField";
import { useLanding } from "./LandingData";
import { MapPreview } from "./MapPreview";
import { LANDING } from "./scenes";

type Mode = "loves" | "home";

const ROLE_ICON: Record<string, LucideIcon> = { coffee: Coffee, food: UtensilsCrossed, bar: Wine, dance: Music, live_music: Mic2, culture: Landmark };
const HOME_IDEAS = [
  { neighborhood: "Kreuzberg", city: "Berlin" },
  { neighborhood: "Alfama", city: "Lisbon" },
  { neighborhood: "Shoreditch", city: "London" },
  { neighborhood: "Le Marais", city: "Paris" },
];

const dateText = (iso?: string) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
};

/** Chips for the loves typed on the landing. A name that matched nothing, or several things, says so instead of guessing. */
function LoveChipsInput({ loves, pending, onRemove, onAdd, onChoose }: {
  loves: ResolvedLove[];
  pending: string[];
  onRemove: (q: string) => void;
  onAdd: (q: string) => void;
  onChoose: (q: string, id: string) => void;
}) {
  const [text, setText] = useState("");
  const unclear = loves.filter((l) => !l.chosen && l.candidates.length >= 2);
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        <AnimatePresence initial={false}>
          {loves.map((l) => (
            <motion.span
              layout
              key={l.query}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              className={`flex h-10 max-w-full items-center gap-1.5 rounded-[11px] pl-1 pr-1 text-[14px] font-[560] ${l.chosen ? "bg-paper-sunk text-ink" : "bg-paper-sunk text-ink-3 ring-1 ring-[color-mix(in_oklch,var(--warn)_60%,transparent)]"}`}
            >
              {l.chosen?.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={l.chosen.image} alt="" className="h-8 w-8 shrink-0 rounded-[8px] object-cover" />
              ) : (
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-[12px] font-[650] text-white ${l.chosen ? "bg-you" : "bg-ink-3"}`}>{l.query[0]?.toUpperCase()}</span>
              )}
              <span className="truncate pl-0.5">{l.chosen?.name ?? l.query}</span>
              <span className="shrink-0 text-[12px] font-[450] text-ink-3">{l.chosen ? DOMAIN_NAME[l.chosen.domain] : l.candidates.length >= 2 ? "Which one?" : "Not found"}</span>
              <button
                aria-label={`Remove ${l.query}`}
                onClick={() => onRemove(l.query)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-ink-3 hover:bg-paper-raised hover:text-ink"
              >
                <X size={14} />
              </button>
            </motion.span>
          ))}
          {pending.map((p) => (
            <motion.span key={`p${p}`} className="flex h-10 items-center gap-2 rounded-[11px] bg-paper-sunk px-3 text-[14px] text-ink-3">
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
              onAdd(text);
              setText("");
            } else if (e.key === "Backspace" && !text && loves.length) onRemove(loves[loves.length - 1].query);
          }}
          onBlur={() => {
            if (text.trim()) {
              onAdd(text);
              setText("");
            }
          }}
          placeholder={loves.length ? "Add another" : "An artist, a show, a book, a brand"}
          aria-label="Add something you love"
          className="h-10 min-w-[150px] flex-1 bg-transparent px-2 text-[15.5px] outline-none placeholder:text-ink-3"
        />
      </div>
      {unclear.map((l) => (
        <div key={l.query} className="mt-2 rounded-[12px] bg-paper-sunk/70 p-2">
          <p className="mb-1.5 px-1 text-[13px] text-ink-2">
            Which <strong className="font-[600] text-ink">{l.query}</strong> do you mean?
          </p>
          <div className="flex flex-wrap gap-1.5">
            {l.candidates.slice(0, 3).map((c) => (
              <button
                key={c.id + c.domain}
                onClick={() => onChoose(l.query, c.id)}
                className="flex min-h-10 items-center gap-2 rounded-[10px] bg-paper-raised px-2.5 text-left text-[13.5px] ring-1 ring-line hover:shadow-[var(--shadow-rest)]"
              >
                <span className="font-[580] text-ink">{c.name}</span>
                <span className="text-[12px] text-ink-3">{DOMAIN_NAME[c.domain]}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The example answer, shown next to the map: three areas and a real place or two in each. */
function ExampleShortlist({ areas, loves, city, when, edited, href }: { areas: ShortlistArea[]; loves: string[]; city: string; when: string | null; edited: boolean; href: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.15, ease: [0.2, 0.8, 0.2, 1] }}
      data-testid="hero-example"
      className="w-full rounded-[22px] bg-paper-raised/95 p-4 shadow-[var(--shadow-overlay)] ring-1 ring-line backdrop-blur md:w-[360px]"
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[12.5px] font-[620] uppercase tracking-[0.06em] text-ink-3">{edited ? "The example you started from" : "Example result"}</p>
        {when && <p className="text-[12px] text-ink-3">Computed {when}</p>}
      </div>
      <p className="mt-1 text-[14px] leading-snug text-ink-2">
        For <span className="font-[580] text-ink">{loves.join(", ")}</span>, moving to {city}
      </p>
      <ol className="mt-3 space-y-2.5">
        {areas.slice(0, 3).map((a) => (
          <li key={a.id} className="flex gap-3">
            <span className={`tnum grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-[13px] font-[660] ${a.rank === 1 ? "bg-you text-white" : "bg-ink text-paper"}`}>{a.rank}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[16px] font-[630] leading-tight tracking-[-0.015em] text-ink">{a.label}</p>
              <ul className="mt-0.5 space-y-0.5">
                {a.anchors.slice(0, 2).map((x) => {
                  const Icon = (x.role && ROLE_ICON[x.role]) || MapPin;
                  return (
                    <li key={x.id} className="flex min-w-0 items-center gap-1.5 text-[13px] text-ink-2">
                      <Icon size={12.5} strokeWidth={1.9} className="shrink-0 text-ink-3" aria-hidden />
                      <span className="truncate">{x.name}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </li>
        ))}
      </ol>
      <Link href={href} className="mt-3 flex h-10 items-center justify-center gap-1.5 rounded-[12px] text-[14px] font-[600] text-you-deep ring-1 ring-line transition-colors hover:bg-you-soft">
        Open this example <ArrowRight size={14} />
      </Link>
    </motion.div>
  );
}

export function Hero() {
  const router = useRouter();
  const { data, settled, markReady, heroReady } = useLanding();
  const scene = data?.hero ?? null;
  const [mode, setMode] = useState<Mode>("loves");
  const [city, setCity] = useState(LANDING.hero.city);
  const [loves, setLoves] = useState<ResolvedLove[]>([]);
  const [edited, setEdited] = useState(false);
  const [pending, setPending] = useState<string[]>([]);
  const [oldCity, setOldCity] = useState("Berlin");
  const [oldHood, setOldHood] = useState("");

  // the example's loves start in the field, so the button works at once; any edit makes them the person's own
  useEffect(() => {
    if (!settled || edited) return;
    if (scene) setLoves(scene.loves);
    else void resolveNames(LANDING.hero.loves).then((r) => setLoves(r.filter((l) => l.chosen)));
  }, [settled, scene, edited]);

  const add = async (q: string) => {
    const v = q.trim().slice(0, 120);
    if (!v || loves.length >= LIMITS.loves || loves.some((l) => l.query.toLowerCase() === v.toLowerCase())) return;
    setEdited(true);
    setPending((p) => [...p, v]);
    const [l] = await resolveNames([v]);
    setPending((p) => p.filter((x) => x !== v));
    setLoves((cur) => [...cur, l]);
  };
  const remove = (q: string) => {
    setEdited(true);
    setLoves((c) => c.filter((x) => x.query !== q));
  };
  const choose = (q: string, id: string) => setLoves((c) => c.map((l) => (l.query === q ? { ...l, chosen: l.candidates.find((x) => x.id === id) ?? l.chosen } : l)));

  const chosen = loves.filter((l) => l.chosen);
  const changedCity = city !== LANDING.hero.city;
  const go = () => {
    const s = { ...emptyState(city), loves: chosen };
    router.push(`/explore?s=${encodeState(s)}`);
  };
  const goHome = () => {
    if (!oldCity.trim() || !oldHood.trim()) return;
    // the example loves are not sent along: only what the person typed themselves
    const s = { ...emptyState(city), loves: edited ? chosen : [] };
    router.push(`/explore/home?s=${encodeState(s)}&from=${encodeURIComponent(oldCity.trim())}&hood=${encodeURIComponent(oldHood.trim())}`);
  };

  const areas = useMemo(() => toShortlist(scene?.areas?.length ? scene.areas : scene?.hoods ?? null), [scene]);
  const exampleHref = scene ? `/explore?s=${encodeState({ ...emptyState(scene.city), loves: scene.loves })}` : "/explore";
  const exampleLoves = scene?.loves.map((l) => l.chosen?.name ?? l.query) ?? LANDING.hero.loves.map((n) => (typeof n === "string" ? n : n.name));

  const [heroPad, setHeroPad] = useState({ top: 120, bottom: 80, left: 40, right: 40 });
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1024px)").matches;
    setHeroPad(
      wide
        ? { top: 130, bottom: 110, left: Math.round(window.innerWidth * 0.43), right: Math.round(Math.min(420, window.innerWidth * 0.3)) }
        : { top: 40, bottom: 40, left: 30, right: 30 },
    );
  }, []);

  return (
    <section className="relative isolate overflow-hidden pb-8 lg:min-h-[100svh] lg:pb-0">
      <header className="relative z-10 mx-auto flex max-w-[1440px] items-center justify-between px-5 pt-5 md:px-10">
        <Link href="/" className="flex items-center gap-2" aria-label="Homing">
          <LogoMark size={30} />
          <span className="text-[23px] font-[680] tracking-[-0.03em]">homing</span>
        </Link>
        <nav className="flex items-center gap-1 rounded-[14px] bg-paper/85 p-1 text-[15px] shadow-[var(--shadow-rest)] ring-1 ring-line backdrop-blur">
          <a href="#how" className="rounded-[10px] px-3 py-2 text-ink-2 hover:bg-paper-sunk hover:text-ink">
            How it works
          </a>
          <a href="#demo" className="hidden rounded-[10px] px-3 py-2 text-ink-2 hover:bg-paper-sunk hover:text-ink sm:block">
            Tour
          </a>
          <a href="https://github.com/DarinaX2005X/qloo-hackathon" className="rounded-[10px] px-3 py-2 text-ink-2 hover:bg-paper-sunk hover:text-ink">
            Code
          </a>
        </nav>
      </header>

      <div className="relative z-10 mx-auto max-w-[1440px] px-5 pt-8 md:px-10 lg:pt-[7vh]">
        <div className="max-w-[540px]">
          <h1 className="text-[42px] font-[700] leading-[1.02] tracking-[-0.04em] text-ink sm:text-[58px] lg:text-[64px]">
            Find your neighborhood in a new city
          </h1>
          <p className="mt-5 max-w-[480px] text-[17.5px] leading-[1.5] text-ink-2 sm:text-[19px]">
            Bring the things you love, or a neighborhood you loved living in. Homing suggests three areas to start your home search, each with real places to check.
          </p>

          <div className="mt-7 rounded-[22px] bg-paper-raised/95 p-3 shadow-[var(--shadow-overlay)] ring-1 ring-line backdrop-blur">
            <Segmented
              label="Start from"
              value={mode}
              onChange={setMode}
              options={[
                { value: "loves", label: "Things I love" },
                { value: "home", label: "Where I lived" },
              ]}
            />
            <div className="p-1 pt-3">
              {mode === "loves" ? (
                <LoveChipsInput loves={loves} pending={pending} onRemove={remove} onAdd={(q) => void add(q)} onChoose={choose} />
              ) : (
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-2" data-testid="hero-home">
                  <label className="block">
                    <span className="mb-1 block text-[12.5px] font-[560] text-ink-3">City you lived in</span>
                    <CityPicker value={oldCity} onChange={setOldCity} />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[12.5px] font-[560] text-ink-3">Neighborhood</span>
                    <input
                      data-testid="hero-home-hood"
                      value={oldHood}
                      onChange={(e) => setOldHood(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && goHome()}
                      placeholder="Kreuzberg"
                      maxLength={80}
                      autoComplete="off"
                      spellCheck={false}
                      className="h-10 w-full rounded-[12px] bg-paper-raised px-3 text-[15px] font-[560] text-ink ring-1 ring-line outline-none placeholder:font-[450] placeholder:text-ink-3 focus:ring-2 focus:ring-you"
                    />
                  </label>
                  <div className="col-span-2 flex flex-wrap gap-1.5">
                    {HOME_IDEAS.filter((h) => h.city !== cityName(city)).map((h) => (
                      <button
                        key={h.neighborhood}
                        type="button"
                        onClick={() => {
                          setOldCity(h.city);
                          setOldHood(h.neighborhood);
                        }}
                        className={`h-8 rounded-[8px] px-2.5 text-[13px] font-[540] transition-colors ${oldHood === h.neighborhood && oldCity === h.city ? "bg-ink text-paper" : "bg-paper-sunk text-ink-2 hover:text-ink"}`}
                      >
                        {h.neighborhood}, {h.city}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="block sm:w-[230px]">
                <span className="mb-1 block px-1 text-[12.5px] font-[560] text-ink-3">Moving to</span>
                <CityPicker variant="hero" value={city} onChange={setCity} />
              </label>
              {mode === "loves" ? (
                <Button variant="primary" size="lg" className="w-full sm:w-auto sm:flex-1" onClick={go} disabled={!chosen.length || pending.length > 0} data-testid="hero-go">
                  Find my areas <ArrowRight size={17} />
                </Button>
              ) : (
                <Button variant="primary" size="lg" className="w-full sm:w-auto sm:flex-1" onClick={goHome} disabled={!oldHood.trim() || !oldCity.trim()} data-testid="hero-go-home">
                  <House size={17} /> Find areas like it
                </Button>
              )}
            </div>
          </div>
          <p className="mt-3 flex items-center gap-1.5 px-1 text-[13px] text-ink-3">
            <Sparkles size={13} className="shrink-0" />
            {mode === "loves"
              ? edited || changedCity
                ? "Homing compares the areas of the city for these loves when you press the button."
                : "The loves above are the example on the map. Change them to make it yours."
              : "Homing reads the places that define your old neighborhood and looks for areas with a similar mix."}
          </p>
        </div>
      </div>

      {/* the map: the example result, full bleed on desktop, a card on a phone */}
      <div className="relative mx-5 mt-6 h-[420px] overflow-hidden rounded-[24px] shadow-[var(--shadow-raised)] ring-1 ring-line lg:absolute lg:inset-0 lg:-z-10 lg:m-0 lg:h-auto lg:rounded-none lg:shadow-none lg:ring-0">
        <TerrainMap field={scene?.field ?? null} neighborhoods={areas} variant="hero" padding={heroPad} onReady={() => markReady("hero")} />
        <MapPreview field={scene?.field ?? null} areas={areas} padding={heroPad} hidden={heroReady} />
        <div className="pointer-events-none absolute inset-y-0 left-0 hidden w-[50%] bg-gradient-to-r from-paper from-35% via-paper/80 to-transparent lg:block" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-28 bg-gradient-to-t from-paper to-transparent lg:block" />
        {!scene && settled && (
          <div className="absolute inset-0 grid place-items-center">
            <p className="max-w-[300px] rounded-[14px] bg-paper-raised/95 px-4 py-3 text-center text-[14px] text-ink-2 shadow-[var(--shadow-rest)]">The example map could not load right now. The search above still works.</p>
          </div>
        )}
      </div>
      {areas.length > 0 && (
        <div className="relative mx-5 mt-3 lg:absolute lg:bottom-10 lg:right-10 lg:mx-0 lg:mt-0">
          <ExampleShortlist areas={areas} loves={exampleLoves} city={scene?.city ?? LANDING.hero.city} when={dateText(scene?.meta?.dataAsOf ?? scene?.meta?.generatedAt)} edited={edited} href={exampleHref} />
        </div>
      )}
    </section>
  );
}
