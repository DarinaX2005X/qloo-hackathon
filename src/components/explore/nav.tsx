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
  /** main = the decision path (Map, Ask); tools = actions on a result, reachable but not equal to the main path */
  group: "main" | "tools";
  /** shown in the mobile tab bar; the rest live in the More sheet */
  tab: boolean;
};

// §13.5: the main path is Map (with the shortlist) and Ask. Feels like home is a way to give the input, Address and
// Visit are actions on a chosen area, Why is the proof behind it, Compare is an action on two results. Their deep links
// keep working; they are not equal icons next to the main path.
export const SCREENS: Screen[] = [
  { path: "/explore", label: "Map", title: "Map and shortlist", blurb: "Your taste over the city and the areas to start with.", icon: MapIcon, group: "main", tab: true },
  { path: "/explore/assistant", label: "Ask", title: "Ask Homing", blurb: "Ask in your own words; Homing checks and changes the map for you.", icon: MessagesSquare, group: "main", tab: true },
  { path: "/explore/home", label: "Home", title: "Feels like home", blurb: "Start from a neighborhood you loved and find what is closest to it here.", icon: House, group: "tools", tab: false },
  { path: "/explore/address", label: "Address", title: "Check an address", blurb: "See the area around a flat and the everyday places within a short walk.", icon: MapPin, group: "tools", tab: false },
  { path: "/explore/why", label: "Why", title: "Why this area", blurb: "What your loves change in the ranking, and the places behind it.", icon: Scale, group: "tools", tab: false },
  { path: "/explore/trip", label: "Visit", title: "Try the neighborhood", blurb: "A short walk of three or four places to test an area in person.", icon: Route, group: "tools", tab: false },
  { path: "/explore/compare", label: "Compare", title: "Compare", blurb: "Two areas side by side, or the same taste in two cities.", icon: Columns2, group: "tools", tab: false },
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
