"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Columns2, House, MapPin, Map as MapIcon, MessagesSquare, Route, Scale, type LucideIcon } from "lucide-react";
import { encodeState } from "@/lib/state";
import { useExplore } from "./store";

export type ScreenPath = "/explore" | "/explore/assistant" | "/explore/home" | "/explore/address" | "/explore/why" | "/explore/trip" | "/explore/compare";

export type Screen = {
  path: ScreenPath;
  /** short label under the icon */
  label: string;
  /** full name, for tooltips, screen readers and the More sheet */
  title: string;
  /** one sentence for the More sheet */
  blurb: string;
  icon: LucideIcon;
  /** shown in the mobile tab bar; the rest live in the More sheet */
  tab: boolean;
};

export const SCREENS: Screen[] = [
  { path: "/explore", label: "Map", title: "Map", blurb: "Your taste over the city and the ranked neighborhoods.", icon: MapIcon, tab: true },
  { path: "/explore/assistant", label: "Assistant", title: "Assistant", blurb: "Ask in your own words and Homing changes the map for you.", icon: MessagesSquare, tab: true },
  { path: "/explore/home", label: "Home", title: "Feels like home", blurb: "Find the part of this city that feels like a neighborhood you loved.", icon: House, tab: true },
  { path: "/explore/address", label: "Address", title: "Check an address", blurb: "See how the area around a flat fits your taste.", icon: MapPin, tab: true },
  { path: "/explore/why", label: "Why", title: "What decides", blurb: "Which of your loves the ranking really rests on.", icon: Scale, tab: false },
  { path: "/explore/trip", label: "Trip", title: "Trip", blurb: "Your first days, day by day, and the places you saved.", icon: Route, tab: false },
  { path: "/explore/compare", label: "Compare", title: "Compare", blurb: "Two neighborhoods side by side, or the same taste in other cities.", icon: Columns2, tab: false },
];

export function screenOf(pathname: string): ScreenPath {
  const hit = SCREENS.find((s) => s.path !== "/explore" && pathname.startsWith(s.path));
  return hit?.path ?? "/explore";
}

/** Links between screens carry the current state in `?s=`, so a screen is always shareable as it is. */
export function useScreenHref() {
  const { state, hydrated } = useExplore();
  return useCallback((path: ScreenPath) => (hydrated ? `${path}?s=${encodeState(state)}` : path), [state, hydrated]);
}

/** Navigate to a screen, keeping the state. */
export function useGoTo() {
  const router = useRouter();
  const { state, hydrated, beginNav } = useExplore();
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });
  return useCallback(
    (path: ScreenPath) => {
      beginNav(path);
      // the state may have just been patched in the same click; the pathname change rewrites ?s= with the latest
      router.push(hydrated ? `${path}?s=${encodeState(stateRef.current)}` : path, { scroll: false });
    },
    [router, hydrated, beginNav],
  );
}

/** ≤ 860 px wide: bottom sheets and a tab bar instead of side panels and a rail. */
export function useIsMobile() {
  const [m, setM] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(max-width: 860px)");
    const on = () => setM(q.matches);
    on();
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return m;
}
