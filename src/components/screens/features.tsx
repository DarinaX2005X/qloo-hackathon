"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { DecidesResult, ExploreState, HomeResult, SpotResult } from "@/shared/contracts";
import { activeLoves } from "@/shared/contracts";
import type { AblationV2, AddressResultV2, CityComparisonV2, Claim, HomeMatchV2, ResultMeta, SourceAreaV2, SourceSignatureSummary, TasteFieldV2 } from "@/shared/contracts-09";
import { HomingError } from "@/components/explore/api";
import { useExplore } from "@/components/explore/store";
import { api09, decidesFromLegacy, homeFromLegacy, spotFromLegacy } from "./api09";

type HomeSource = {
  city: string;
  neighborhood: string;
  point?: [number, number];
};
type SpotWhere = { query?: string; point?: [number, number] };

/** What the Home screen shows: a full /api/home answer, or the matches an assistant card carried. */
export type HomeView = {
  meta?: ResultMeta;
  sourceSignatureSummary?: SourceSignatureSummary;
  matches: HomeMatchV2[];
  field?: TasteFieldV2;
};
export type AddressView = AddressResultV2 & { meta?: ResultMeta };
export type ExplainView = {
  meta?: ResultMeta;
  baseOrder?: string[];
  ablations: AblationV2[];
  claims: Claim[];
};
export type ComparisonView = CityComparisonV2 & { meta?: ResultMeta };

/** Home + your taste: how much the person's own ranking weighs in (§5.7, lambda ≤ 0.5). */
export const HOME_BLEND_LAMBDA = 0.35;

const norm = (c: string) => c.trim().toLowerCase();
/** Everything that changes the ranking: a result computed for another key is out of date. */
export const signalKey = (s: ExploreState) =>
  JSON.stringify([
    norm(s.city),
    activeLoves(s.loves).map((l) => [l.chosen.id, l.weight]),
    s.refinements.map((t) => t.id),
    s.companion ? activeLoves(s.companion.loves).map((l) => [l.chosen.id, l.weight]) : null,
  ]);

const asError = (e: unknown) => (e instanceof HomingError ? e : new HomingError("network", "Something went wrong. Try again."));

/**
 * Every slot remembers the city it was computed for (null = handed in by the assistant, pinned
 * to the current city on the next commit). Only slots of the current city are ever exposed.
 */
type Slot<T, X> = {
  data: T | null;
  loading: boolean;
  error: HomingError | null;
  city: string | null;
  key: string | null;
} & X;
type RecentEntry = {
  result: AddressView;
  key: string;
  query: string | null;
  city: string;
};
type CitiesExtra = {
  asked: string[];
  source: SourceAreaV2 | null;
  /** the state revision the comparison was made for */ rev: number | null;
};

function useFeaturesStore() {
  const ex = useExplore();
  const revision = ex.revision;
  const constraints = ex.constraints;
  const stateRef = useRef(ex.state);
  stateRef.current = ex.state;
  const revRef = useRef(revision);
  revRef.current = revision;
  const consRef = useRef(constraints);
  consRef.current = constraints;
  const city = norm(ex.state.city);
  const key = signalKey(ex.state);

  const [home, setHome] = useState<Slot<HomeView, { request: { city: string; neighborhood: string } | null; lambda: number }>>({
    data: null,
    loading: false,
    error: null,
    city: null,
    key: null,
    request: null,
    lambda: 0,
  });
  const [spot, setSpot] = useState<Slot<AddressView, { query: string | null }>>({
    data: null,
    loading: false,
    error: null,
    city: null,
    key: null,
    query: null,
  });
  const [decides, setDecides] = useState<Slot<ExplainView, { areaId: string | null }>>({
    data: null,
    loading: false,
    error: null,
    city: null,
    key: null,
    areaId: null,
  });
  // a comparison is not tied to the map's city: it keeps its own list and never changes state.city
  const [cities, setCities] = useState<Omit<Slot<ComparisonView, CitiesExtra>, "city">>({
    data: null,
    loading: false,
    error: null,
    key: null,
    asked: [],
    source: null,
    rev: null,
  });
  const [recent, setRecent] = useState<RecentEntry[]>([]);

  const homeAc = useRef<AbortController | null>(null);
  const spotAc = useRef<AbortController | null>(null);
  const decidesAc = useRef<AbortController | null>(null);
  const citiesAc = useRef<AbortController | null>(null);

  /** the city each running request was made for */
  const madeFor = useRef(new WeakMap<AbortController, string>());
  // a request still running for the old city is cancelled when the city changes; a screen's effects
  // run before this one, so a request it just started for the new city is left alone
  useEffect(() => {
    for (const slot of [homeAc, spotAc, decidesAc]) {
      const ac = slot.current;
      if (ac && madeFor.current.get(ac) !== city) ac.abort();
    }
  }, [city]);
  useEffect(
    () => () => {
      homeAc.current?.abort();
      spotAc.current?.abort();
      decidesAc.current?.abort();
      citiesAc.current?.abort();
    },
    [],
  );
  // results handed in by the assistant belong to the city that is current once they render
  const unpinned = (home.data && home.city === null) || (spot.data && spot.city === null) || (decides.data && decides.city === null);
  useEffect(() => {
    if (!unpinned) return;
    const k = signalKey(stateRef.current);
    const pin = <S extends { data: unknown; city: string | null; key: string | null }>(s: S): S => (s.data && s.city === null ? { ...s, city, key: s.key ?? k } : s);
    setHome(pin);
    setSpot(pin);
    setDecides(pin);
  }, [unpinned, city]);

  /** Runs a request for the state as it is now; the answer is dropped if the city changed meanwhile. */
  const run = useCallback(async <T,>(slot: React.RefObject<AbortController | null>, fn: (s: ExploreState, rev: number, signal: AbortSignal) => Promise<T>, keepCity = false) => {
    slot.current?.abort();
    const ac = new AbortController();
    slot.current = ac;
    const s = stateRef.current;
    const c = norm(s.city);
    madeFor.current.set(ac, c);
    const moved = () => !keepCity && norm(stateRef.current.city) !== c;
    try {
      const data = await fn(s, revRef.current, ac.signal);
      if (ac.signal.aborted || moved()) return { kind: "dropped" as const };
      return { kind: "ok" as const, data, key: signalKey(s), city: c };
    } catch (e) {
      const err = asError(e);
      if (err.code === "aborted" || ac.signal.aborted || moved()) return { kind: "dropped" as const };
      return { kind: "error" as const, error: err, city: c };
    } finally {
      if (slot.current === ac) slot.current = null;
    }
  }, []);

  const findHome = useCallback(
    async (source: HomeSource, lambda = 0) => {
      const request = {
        city: source.city.trim(),
        neighborhood: source.neighborhood.trim(),
      };
      if (!request.city || !request.neighborhood) return;
      const lam = Math.max(0, Math.min(0.5, lambda));
      const c = norm(stateRef.current.city);
      setHome((h) => ({
        ...h,
        data: h.city === c ? h.data : null,
        city: c,
        loading: true,
        error: null,
        request,
        lambda: lam,
      }));
      const r = await run(homeAc, (s, rev, signal) => api09.home(s, rev, { ...request, ...(source.point ? { point: source.point } : {}) }, lam, consRef.current, signal));
      if (r.kind === "ok")
        setHome({
          data: r.data,
          loading: false,
          error: null,
          city: r.city,
          key: r.key,
          request,
          lambda: lam,
        });
      else if (r.kind === "error")
        setHome({
          data: null,
          loading: false,
          error: r.error,
          city: r.city,
          key: null,
          request,
          lambda: lam,
        });
      else setHome((h) => (h.loading && h.request === request ? { ...h, loading: false } : h));
    },
    [run],
  );
  /** A Home result handed in by the assistant: a v2 card's matches (with the result meta), or an old HomeResult. */
  const showHome = useCallback((result: HomeView | HomeResult, meta?: ResultMeta) => {
    homeAc.current?.abort();
    const v: HomeView = "source" in result ? homeFromLegacy(result, stateRef.current, revRef.current, 0) : { ...result, meta: result.meta ?? meta };
    const src = v.sourceSignatureSummary;
    setHome({
      data: v,
      loading: false,
      error: null,
      city: null,
      key: null,
      request: src ? { city: src.cityName, neighborhood: src.area.name } : null,
      lambda: v.matches[0]?.orderReason === "home_personal_blend" ? HOME_BLEND_LAMBDA : 0,
    });
  }, []);

  const remember = useCallback((result: AddressView, k: string, query: string | null, c: string) => {
    setRecent((list) => [{ result, key: k, query, city: c }, ...list.filter((x) => x.city !== c || x.result.label.toLowerCase() !== result.label.toLowerCase())].slice(0, 12));
  }, []);

  const checkSpot = useCallback(
    async (where: SpotWhere & { areaId?: string }) => {
      const query = where.query?.trim() || null;
      if (!query && !where.point) return;
      const c = norm(stateRef.current.city);
      setSpot((sp) => ({
        ...sp,
        data: sp.city === c ? sp.data : null,
        city: c,
        loading: true,
        error: null,
        query,
      }));
      const r = await run(spotAc, (s, rev, signal) =>
        api09.spot(
          s,
          rev,
          {
            ...(query ? { query } : {}),
            ...(where.point ? { point: where.point } : {}),
            ...(where.areaId ? { areaId: where.areaId } : {}),
          },
          consRef.current,
          signal,
        ),
      );
      if (r.kind === "ok") {
        setSpot({
          data: r.data,
          loading: false,
          error: null,
          city: r.city,
          key: r.key,
          query,
        });
        remember(r.data, r.key, query, r.city);
      } else if (r.kind === "error") setSpot((sp) => ({ ...sp, loading: false, error: r.error, query }));
      else setSpot((sp) => (sp.loading && sp.query === query ? { ...sp, loading: false } : sp));
    },
    [run, remember],
  );
  const showSpot = useCallback(
    (result: AddressView | SpotResult, meta?: ResultMeta) => {
      spotAc.current?.abort();
      const v: AddressView = "verdict" in result ? spotFromLegacy(result, stateRef.current, revRef.current) : { ...result, meta: result.meta ?? meta };
      setSpot({
        data: v,
        loading: false,
        error: null,
        city: null,
        key: null,
        query: v.label,
      });
      const s = stateRef.current;
      remember(v, signalKey(s), v.label, norm(s.city));
    },
    [remember],
  );

  const loadDecides = useCallback(
    async (areaId?: string | null) => {
      const c = norm(stateRef.current.city);
      const id = areaId ?? null;
      setDecides((d) => ({
        ...d,
        data: d.city === c ? d.data : null,
        city: c,
        loading: true,
        error: null,
        areaId: id,
      }));
      const r = await run(decidesAc, (s, rev, signal) => api09.decides(s, rev, id ? { areaId: id } : {}, consRef.current, signal));
      if (r.kind === "ok")
        setDecides({
          data: r.data,
          loading: false,
          error: null,
          city: r.city,
          key: r.key,
          areaId: id,
        });
      else if (r.kind === "error") setDecides((d) => ({ ...d, loading: false, error: r.error }));
      else setDecides((d) => (d.loading ? { ...d, loading: false } : d));
    },
    [run],
  );
  const showDecides = useCallback((result: ExplainView | DecidesResult, meta?: ResultMeta) => {
    decidesAc.current?.abort();
    const v: ExplainView = "summary" in result ? decidesFromLegacy(result, stateRef.current, revRef.current) : { ...result, meta: result.meta ?? meta };
    setDecides({
      data: v,
      loading: false,
      error: null,
      city: null,
      key: null,
      areaId: null,
    });
  }, []);

  const compareCities = useCallback(
    async (list: string[], source?: SourceAreaV2 | null) => {
      const asked = [...new Map(list.map((c) => [norm(c), c.trim()])).values()].filter(Boolean).slice(0, 3);
      if (!asked.length) return;
      const src = source ?? null;
      setCities((cs) => ({
        ...cs,
        loading: true,
        error: null,
        asked,
        source: src,
      }));
      const criteria = src ? ["home_similarity", "everyday_venues", "support"] : ["cultural_overlap", "everyday_venues", "support"];
      let madeAt: number | null = null;
      const r = await run(
        citiesAc,
        (s, rev, signal) => {
          madeAt = rev;
          return api09.cities(s, rev, asked, src ?? undefined, criteria, consRef.current, signal);
        },
        true,
      );
      if (r.kind === "ok")
        setCities({
          data: r.data,
          loading: false,
          error: null,
          key: r.key,
          asked,
          source: src,
          rev: r.data.meta?.stateRevision ?? madeAt,
        });
      else if (r.kind === "error") setCities((cs) => ({ ...cs, loading: false, error: r.error }));
      else setCities((cs) => (cs.loading ? { ...cs, loading: false } : cs));
    },
    [run],
  );
  const showComparison = useCallback((result: CityComparisonV2, meta?: ResultMeta) => {
    citiesAc.current?.abort();
    setCities((cs) => ({
      ...cs,
      data: { ...result, meta },
      loading: false,
      error: null,
      key: null,
      asked: result.results.map((r) => r.cityName),
      rev: meta?.stateRevision ?? revRef.current,
    }));
  }, []);

  return useMemo(() => {
    const mine = (c: string | null, hasData: boolean) => c === city || (c === null && hasData);
    const homeOk = mine(home.city, !!home.data);
    const spotOk = mine(spot.city, !!spot.data);
    const decOk = mine(decides.city, !!decides.data);
    return {
      home: {
        data: homeOk ? home.data : null,
        loading: homeOk && home.loading,
        error: homeOk ? home.error : null,
        request: homeOk ? home.request : null,
        lambda: home.lambda,
        /** Home + your taste depends on the loves: they changed since */
        stale: homeOk && !!home.data && home.lambda > 0 && home.key !== null && home.key !== key,
      },
      findHome,
      showHome,
      spot: {
        data: spotOk ? spot.data : null,
        loading: spotOk && spot.loading,
        error: spotOk ? spot.error : null,
        query: spotOk ? spot.query : null,
        /** the loves or filters changed since this spot was checked */
        stale: spotOk && !!spot.data && spot.key !== null && spot.key !== key,
      },
      checkSpot,
      showSpot,
      /** the last five checked spots in this city, newest first */
      recentSpots: recent
        .filter((r) => r.city === city)
        .slice(0, 5)
        .map((r) => ({ ...r, stale: r.key !== key })),
      decides: {
        data: decOk ? decides.data : null,
        loading: decOk && decides.loading,
        error: decOk ? decides.error : null,
        areaId: decOk ? decides.areaId : null,
        stale: decOk && !!decides.data && decides.key !== null && decides.key !== key,
      },
      loadDecides,
      showDecides,
      /** made for older inputs (loves, weights, partner, budget, constraints): shown as such, never re-applied */
      cities: {
        ...cities,
        stale: !!cities.data && ((cities.rev !== null && cities.rev < revision) || (cities.key !== null && cities.key !== key)),
      },
      compareCities,
      showComparison,
    };
  }, [city, key, revision, home, findHome, showHome, spot, checkSpot, showSpot, recent, decides, loadDecides, showDecides, cities, compareCities, showComparison]);
}

export type Features = ReturnType<typeof useFeaturesStore>;
const Ctx = createContext<Features | null>(null);

export function FeaturesProvider({ children }: { children: React.ReactNode }) {
  const value = useFeaturesStore();
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFeatures() {
  const f = useContext(Ctx);
  if (!f) throw new Error("useFeatures outside FeaturesProvider");
  return f;
}
