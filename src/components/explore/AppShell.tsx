"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { Check, Ellipsis, Link2, ListOrdered, Map as MapIcon, MessagesSquare, X } from "lucide-react";
import { activeLoves } from "@/shared/contracts";
import { useExplore, type MobileSheet } from "./store";
import { TerrainMap } from "@/components/map/TerrainMap";
import { Toast } from "./Toast";
import { LogoMark } from "@/components/brand/Logo";
import { CityPicker, cityName } from "@/components/ui/CityPicker";
import { Button, Spinner } from "@/components/ui/primitives";
import { SCREENS, screenOf, useGoTo, useIsMobile, useScreenHref, type ScreenPath } from "./nav";

/** Desktop rail width; panels and the map start right of it. */
export const RAIL = 76;
/** Mobile tab bar height (plus the safe area). */
export const TABBAR = 64;

/** Width of the left panel on each screen (desktop), and whether a right panel sits over the map. */
const PANELS: Record<ScreenPath, { left: number; right: number }> = {
  "/explore": { left: 392, right: 0 },
  "/explore/assistant": { left: 560, right: 0 },
  "/explore/home": { left: 440, right: 0 },
  "/explore/address": { left: 440, right: 0 },
  "/explore/why": { left: 440, right: 0 },
  "/explore/trip": { left: 460, right: 0 },
  "/explore/compare": { left: 620, right: 0 },
};

export function ShareButton({ compact = false }: { compact?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      data-testid={compact ? "share-button-mobile" : "share-button"}
      variant="secondary"
      size="md"
      aria-label={compact ? (done ? "Link copied" : "Share this map") : undefined}
      className={compact ? "w-10 shrink-0 px-0" : ""}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(window.location.href);
        } catch {
          /* clipboard blocked; the URL is still in the address bar */
        }
        setDone(true);
        setTimeout(() => setDone(false), 1800);
      }}
    >
      {done ? <Check size={16} className="text-ok" /> : <Link2 size={16} strokeWidth={1.9} />}
      {!compact && (done ? "Link copied" : "Share")}
    </Button>
  );
}

function Status({ mobile }: { mobile: boolean }) {
  const ex = useExplore();
  const busy = ex.field.loading || ex.hoods.loading;
  const label = ex.field.loading ? "Mapping your taste" : ex.hoods.loading ? "Ranking neighborhoods" : null;
  return (
    <AnimatePresence>
      {busy && label && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          className="pointer-events-none absolute top-[84px] z-20 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-ink px-3.5 py-2 text-[13px] font-[540] text-paper shadow-[var(--shadow-raised)]"
          style={{ left: mobile ? "50%" : `calc(50% + ${RAIL / 2}px)` }}
        >
          <Spinner size={13} /> {label} in {cityName(ex.state.city)}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function RailLink({ s, active, compact }: { s: (typeof SCREENS)[number]; active: ScreenPath; compact?: boolean }) {
  const href = useScreenHref();
  const on = s.path === active;
  const Icon = s.icon;
  return (
    <Link
      href={href(s.path)}
      scroll={false}
      aria-current={on ? "page" : undefined}
      aria-label={s.title}
      title={s.title}
      data-testid={`nav-${s.label.toLowerCase()}`}
      className={`group relative flex w-[64px] flex-col items-center gap-1 rounded-[14px] pb-1.5 pt-2 ${compact ? "text-[11px]" : "text-[11.5px]"} font-[580] tracking-[-0.01em] transition-colors ${on ? "text-you-deep" : compact ? "text-ink-3 hover:text-ink" : "text-ink-2 hover:text-ink"}`}
    >
      {on && <motion.span layoutId="rail-active" className="absolute inset-0 -z-10 rounded-[14px] bg-you-soft" transition={{ type: "spring", stiffness: 520, damping: 40 }} />}
      <span className={`grid ${compact ? "h-7 w-7" : "h-8 w-8"} place-items-center rounded-[10px] transition-transform duration-150 group-active:scale-95 ${on ? "" : "group-hover:bg-paper-sunk"}`}>
        <Icon size={compact ? 17 : 19} strokeWidth={on ? 2.1 : 1.8} />
      </span>
      {s.label}
    </Link>
  );
}

function Rail({ active }: { active: ScreenPath }) {
  return (
    <nav aria-label="Screens" className="absolute inset-y-0 left-0 z-40 flex flex-col items-center gap-1 border-r border-line bg-paper-raised/95 pt-3 backdrop-blur" style={{ width: RAIL }}>
      {SCREENS.filter((s) => s.group === "main").map((s) => (
        <RailLink key={s.path} s={s} active={active} />
      ))}
      <span aria-hidden className="my-2 h-px w-9 bg-line" />
      {SCREENS.filter((s) => s.group === "tools").map((s) => (
        <RailLink key={s.path} s={s} active={active} compact />
      ))}
    </nav>
  );
}

function TabBar({ active }: { active: ScreenPath }) {
  const href = useScreenHref();
  const ex = useExplore();
  const [more, setMore] = useState(false);
  const moreActive = SCREENS.some((s) => !s.tab && s.path === active);
  useEffect(() => setMore(false), [active]);
  // Map and Shortlist are the same screen: the map with its sheet peeked, or the sheet open on the shortlist
  const tabs: { key: string; label: string; title: string; icon: typeof MapIcon; path: ScreenPath; on: boolean; sheet?: MobileSheet }[] = [
    { key: "map", label: "Map", title: "Map", icon: MapIcon, path: "/explore", on: active === "/explore" && ex.mobileSheet === "peek", sheet: "peek" },
    { key: "shortlist", label: "Shortlist", title: "Your shortlist", icon: ListOrdered, path: "/explore", on: active === "/explore" && ex.mobileSheet !== "peek", sheet: "results" },
    { key: "ask", label: "Ask", title: "Ask Homing", icon: MessagesSquare, path: "/explore/assistant", on: active === "/explore/assistant" },
  ];
  return (
    <>
      <AnimatePresence>
        {more && (
          <>
            <motion.div
              key="scrim"
              className="absolute inset-0 z-[45] bg-[oklch(23%_0.02_40/0.22)]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMore(false)}
            />
            <motion.div
              key="sheet"
              role="dialog"
              aria-label="More screens"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 420, damping: 40 }}
              className="absolute inset-x-0 z-[46] rounded-t-[24px] bg-paper-raised px-3 pb-3 pt-3 shadow-[var(--shadow-overlay)] ring-1 ring-line"
              style={{ bottom: `calc(${TABBAR}px + env(safe-area-inset-bottom))` }}
            >
              <div className="mb-1 flex items-center justify-between px-2">
                <h2 className="text-[17px] font-[640] tracking-[-0.015em]">More</h2>
                <button onClick={() => setMore(false)} aria-label="Close" className="grid h-11 w-11 place-items-center rounded-[10px] text-ink-2 hover:bg-paper-sunk">
                  <X size={17} />
                </button>
              </div>
              {SCREENS.filter((s) => !s.tab).map((s) => {
                const Icon = s.icon;
                const on = s.path === active;
                return (
                  <Link
                    key={s.path}
                    href={href(s.path)}
                    scroll={false}
                    onClick={() => setMore(false)}
                    aria-current={on ? "page" : undefined}
                    className={`flex items-center gap-3 rounded-[16px] px-2.5 py-2.5 ${on ? "bg-you-soft" : "active:bg-paper-sunk"}`}
                  >
                    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[12px] ${on ? "bg-you text-white" : "bg-paper-sunk text-ink"}`}>
                      <Icon size={19} strokeWidth={1.9} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[15.5px] font-[600] text-ink">{s.title}</span>
                      <span className="block text-[13px] leading-snug text-ink-2">{s.blurb}</span>
                    </span>
                  </Link>
                );
              })}
            </motion.div>
          </>
        )}
      </AnimatePresence>
      <nav aria-label="Screens" className="hm-safe-bottom absolute inset-x-0 bottom-0 z-[47] grid grid-cols-4 border-t border-line bg-paper-raised">
        {tabs.map((t) => {
          const on = t.on && !more;
          const Icon = t.icon;
          return (
            <Link
              key={t.key}
              href={href(t.path)}
              scroll={false}
              onClick={() => t.sheet && ex.setMobileSheet(t.sheet)}
              aria-current={on ? "page" : undefined}
              aria-label={t.title}
              data-testid={`tab-${t.key}`}
              className={`relative flex flex-col items-center justify-center gap-0.5 text-[11.5px] font-[580] ${on ? "text-you-deep" : "text-ink-2"}`}
              style={{ height: TABBAR }}
            >
              {on && <motion.span layoutId="tab-active" className="absolute top-0 h-[3px] w-8 rounded-b-full bg-you" transition={{ type: "spring", stiffness: 520, damping: 40 }} />}
              <Icon size={21} strokeWidth={on ? 2.1 : 1.8} />
              {t.label}
            </Link>
          );
        })}
        <button
          onClick={() => setMore((v) => !v)}
          aria-expanded={more}
          aria-label="More screens"
          className={`relative flex flex-col items-center justify-center gap-0.5 text-[11.5px] font-[580] ${more || moreActive ? "text-you-deep" : "text-ink-2"}`}
          style={{ height: TABBAR }}
        >
          {(more || moreActive) && <motion.span layoutId="tab-active" className="absolute top-0 h-[3px] w-8 rounded-b-full bg-you" transition={{ type: "spring", stiffness: 520, damping: 40 }} />}
          <Ellipsis size={21} strokeWidth={1.9} />
          {moreActive && !more ? SCREENS.find((s) => s.path === active)?.label : "More"}
        </button>
      </nav>
    </>
  );
}

/**
 * The frame around every explore screen: one persistent map, the rail (or tab bar), and the top bar.
 * Screens render their panels as children over the map; the map never remounts between them.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const ex = useExplore();
  const mobile = useIsMobile();
  const goTo = useGoTo();
  const active = screenOf(ex.pathname);
  const overlay = ex.overlay;
  const [vh, setVh] = useState(800);
  useEffect(() => {
    const on = () => setVh(window.innerHeight);
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  // a place opened on one screen does not follow the person to the next
  const { setOpenPlace } = ex;
  useEffect(() => setOpenPlace(null), [active, setOpenPlace]);

  const pair = !!ex.state.companion && activeLoves(ex.state.companion.loves).length > 0;
  const baseHoods = ex.hoods.data;

  const onClickTerrain = useCallback(
    ([lon, lat]: [number, number]) => {
      if (active !== "/explore") return;
      const hoods = baseHoods ?? [];
      if (!hoods.length) return;
      const k = Math.cos((lat * Math.PI) / 180);
      const near = [...hoods].sort((a, b) => Math.hypot((a.center[0] - lon) * k, a.center[1] - lat) - Math.hypot((b.center[0] - lon) * k, b.center[1] - lat))[0];
      ex.setOpenPlace(null);
      ex.patch([{ op: "select_neighborhood", id: near.id }]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseHoods, active],
  );
  // a plate opens its neighborhood on the Map screen, from any screen
  const onSelect = useCallback(
    (id: string | null) => {
      if (id && !baseHoods?.some((n) => n.id === id)) return;
      ex.patch([{ op: "select_neighborhood", id }]);
      if (id && active !== "/explore") goTo("/explore");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseHoods, active, goTo],
  );
  const loveNames = useMemo(() => Object.fromEntries(activeLoves(ex.state.loves).map((l) => [l.chosen.domain, l.chosen.name])), [ex.state.loves]);
  // on the visit screen the short visit comes first; the older multi-day plan is the fallback
  const tripItinerary = active === "/explore/trip" ? (ex.visit.data?.itinerary ?? ex.plan.data) : ex.plan.data;
  const day = tripItinerary?.days[ex.planDay] ?? tripItinerary?.days[0];
  const route = useMemo(() => day?.stops.map((s) => [s.place.lon, s.place.lat] as [number, number]), [day]);
  const basePlaces = useMemo(() => {
    if (tripItinerary && (active === "/explore/trip" || active === "/explore")) return tripItinerary.days.flatMap((d) => d.stops.map((s) => s.place));
    if (active === "/explore/trip") return ex.saved;
    return active === "/explore" ? ex.visiblePlaces : [];
  }, [tripItinerary, ex.visiblePlaces, ex.saved, active]);

  const panels = PANELS[active];
  const padding = useMemo(() => {
    if (mobile) {
      const layer = vh - TABBAR;
      // the assistant covers the map on a phone; when the map is shown, its composer stays at the bottom
      const sheet =
        active === "/explore/assistant" ? 96 : active === "/explore" && ex.mobileSheet === "peek" ? 112 : ["/explore/home", "/explore/address", "/explore/why"].includes(active) ? Math.round(vh * 0.56) : Math.round(layer * 0.52);
      return { top: 76, bottom: TABBAR + sheet + 16, left: 24, right: 24 };
    }
    return { top: 90, bottom: 40, left: 16 + panels.left + 28, right: panels.right ? 16 + panels.right + 28 : 40 };
  }, [mobile, vh, active, panels, ex.mobileSheet]);

  const field = overlay?.field ?? ex.field.data;
  const flat = overlay ? !!(overlay.pin || overlay.ring) : active === "/explore/trip" && !!tripItinerary;

  // A screen that took the camera close (a spot, a route, a borrowed field) hands back the whole city when the person leaves it.
  const closeUp = !!(overlay?.focus || overlay?.pin || overlay?.field) || flat;
  const wasCloseUp = useRef(false);
  const [reframe, setReframe] = useState(0);
  const hood = ex.state.neighborhood ?? null;
  useEffect(() => {
    if (closeUp) wasCloseUp.current = true;
    else if (wasCloseUp.current) {
      wasCloseUp.current = false;
      if (!hood) setReframe((n) => n + 1);
    }
  }, [closeUp, hood]);

  return (
    <main className="paper-noise relative h-dvh w-full overflow-hidden bg-paper">
      <div className="absolute inset-0" style={{ left: mobile ? 0 : RAIL }}>
        <TerrainMap
          field={field}
          mode={overlay?.field ? "home" : pair ? "pair" : "you"}
          neighborhoods={overlay?.neighborhoods ?? baseHoods ?? []}
          selectedId={overlay?.field || overlay?.neighborhoods ? null : (ex.state.neighborhood ?? null)}
          onSelectNeighborhood={onSelect}
          places={overlay?.places ?? basePlaces}
          activePlaceId={ex.activePlace}
          onHoverPlace={ex.setActivePlace}
          onClickTerrain={overlay?.onMapClick ? undefined : onClickTerrain}
          onClickMap={overlay?.onMapClick}
          route={overlay ? undefined : route}
          loveNames={loveNames}
          pin={overlay?.pin ?? null}
          ring={overlay?.ring ?? null}
          focus={overlay?.focus ?? null}
          flat={flat}
          reframe={reframe}
          padding={padding}
        />
      </div>

      {!mobile && <Rail active={active} />}

      <header className="pointer-events-none absolute right-0 top-0 z-30 flex items-center gap-2.5 px-4 pt-4 [&>*]:pointer-events-auto" style={{ left: mobile ? 0 : RAIL }}>
        <Link href="/" className={`flex h-10 shrink-0 items-center gap-2 rounded-[12px] bg-paper-raised shadow-[var(--shadow-rest)] ring-1 ring-line ${mobile ? "w-10 justify-center" : "pl-2 pr-3"}`} aria-label="Homing home">
          <LogoMark size={26} />
          {!mobile && <span className="text-[19px] font-[680] tracking-[-0.03em]">homing</span>}
        </Link>
        <CityPicker className={`${mobile ? "min-w-0 flex-1" : "w-[200px]"} shadow-[var(--shadow-rest)]`} value={ex.state.city} onChange={(c) => ex.patch([{ op: "set_city", city: c }])} />
        <div className="ml-auto flex shrink-0 items-center gap-2">{mobile ? <ShareButton compact /> : <ShareButton />}</div>
      </header>

      <Status mobile={mobile} />

      <div
        className="hm-screen absolute right-0 top-0 z-20"
        // screens position panels from this layer's corner: --hm-panel-left is the gap after the rail, --hm-tabbar is already taken off
        style={{ left: mobile ? 0 : RAIL, bottom: mobile ? `calc(${TABBAR}px + env(safe-area-inset-bottom))` : 0, ["--hm-panel-left" as string]: "16px", ["--hm-tabbar" as string]: "0px" }}
      >
        {/* screens mount once the state from ?s= is read, so nothing renders (or fetches) for an empty taste first */}
        {ex.hydrated ? children : null}
        <Toast />
      </div>

      {mobile && <TabBar active={active} />}
    </main>
  );
}
