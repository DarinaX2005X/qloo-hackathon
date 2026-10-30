"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { DecidesResult, ExploreState, HomeResult, SpotResult } from "@/shared/contracts";
import { activeLoves } from "@/shared/contracts";
import { api, HomingError } from "@/components/explore/api";
import { useExplore, type Load } from "@/components/explore/store";

type HomeSource = { city: string; neighborhood: string; point?: [number, number] };
type SpotWhere = { query?: string; point?: [number, number] };

const norm = (c: string) => c.trim().toLowerCase();
/** Everything that changes the ranking: a result computed for another key is out of date. */
export const signalKey = (s: ExploreState) =>
  JSON.stringify([
    norm(s.city),
    activeLoves(s.loves).map((l) => [l.chosen.id, l.weight]),
    s.refinements.map((t) => t.id),
    Math.round(s.discovery * 20),
    s.companion ? activeLoves(s.companion.loves).map((l) => [l.chosen.id, l.weight]) : null,
  ]);

const asError = (e: unknown) => (e instanceof HomingError ? e : new HomingError("network", "Something went wrong. Try again."));

/**
 * Every slot remembers the city it was computed for (null = handed in by the assistant, pinned
 * to the current city on the next commit). Only slots of the current city are ever exposed.
 */
type Slot<T, X> = { data: T | null; loading: boolean; error: HomingError | null; city: string | null; key: string | null } & X;
type RecentEntry = { result: SpotResult; key: string; query: string | null; city: string };

function useFeaturesStore() {
  const ex = useExplore();
  const stateRef = useRef(ex.state);
  stateRef.current = ex.state;
  const city = norm(ex.state.city);
  const key = signalKey(ex.state);

  const [home, setHome] = useState<Slot<HomeResult, { request: { city: string; neighborhood: string } | null; blend: number }>>({
    data: null,
    loading: false,
    error: null,
    city: null,
    key: null,
    request: null,
    blend: 0,
  });
  const [spot, setSpot] = useState<Slot<SpotResult, { query: string | null }>>({ data: null, loading: false, error: null, city: null, key: null, query: null });
  const [decides, setDecides] = useState<Slot<DecidesResult, object>>({ data: null, loading: false, error: null, city: null, key: null });
  const [recent, setRecent] = useState<RecentEntry[]>([]);

  const homeAc = useRef<AbortController | null>(null);
  const spotAc = useRef<AbortController | null>(null);
  const decidesAc = useRef<AbortController | null>(null);

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
  const run = useCallback(async <T,>(slot: React.RefObject<AbortController | null>, fn: (s: ExploreState, signal: AbortSignal) => Promise<T>) => {
    slot.current?.abort();
    const ac = new AbortController();
    slot.current = ac;
    const s = stateRef.current;
    const c = norm(s.city);
    madeFor.current.set(ac, c);
    try {
      const data = await fn(s, ac.signal);
      if (ac.signal.aborted || norm(stateRef.current.city) !== c) return { kind: "dropped" as const };
      return { kind: "ok" as const, data, key: signalKey(s), city: c };
    } catch (e) {
      const err = asError(e);
      if (err.code === "aborted" || ac.signal.aborted || norm(stateRef.current.city) !== c) return { kind: "dropped" as const };
      return { kind: "error" as const, error: err, city: c };
    } finally {
      if (slot.current === ac) slot.current = null;
    }
  }, []);

  const findHome = useCallback(
    async (source: HomeSource, blend = 0) => {
      const request = { city: source.city.trim(), neighborhood: source.neighborhood.trim() };
      if (!request.city || !request.neighborhood) return;
      const c = norm(stateRef.current.city);
      setHome((h) => ({ ...h, data: h.city === c ? h.data : null, city: c, loading: true, error: null, request, blend }));
      const r = await run(homeAc, (s, signal) => api.home(s, { ...request, ...(source.point ? { point: source.point } : {}) }, blend, signal));
      if (r.kind === "ok") setHome({ data: r.data, loading: false, error: null, city: r.city, key: r.key, request, blend });
      else if (r.kind === "error") setHome({ data: null, loading: false, error: r.error, city: r.city, key: null, request, blend });
      else setHome((h) => (h.loading && h.request === request ? { ...h, loading: false } : h));
    },
    [run],
  );
  const showHome = useCallback((result: HomeResult) => {
    homeAc.current?.abort();
    setHome({ data: result, loading: false, error: null, city: null, key: null, request: { city: result.source.city, neighborhood: result.source.neighborhood }, blend: 0 });
  }, []);

  const remember = useCallback((result: SpotResult, k: string, query: string | null, c: string) => {
    setRecent((list) => [{ result, key: k, query, city: c }, ...list.filter((x) => x.city !== c || x.result.label.toLowerCase() !== result.label.toLowerCase())].slice(0, 12));
  }, []);

  const checkSpot = useCallback(
    async (where: SpotWhere) => {
      const query = where.query?.trim() || null;
      if (!query && !where.point) return;
      const c = norm(stateRef.current.city);
      setSpot((sp) => ({ ...sp, data: sp.city === c ? sp.data : null, city: c, loading: true, error: null, query }));
      const r = await run(spotAc, (s, signal) => api.spot(s, { ...(query ? { query } : {}), ...(where.point ? { point: where.point } : {}) }, signal));
      if (r.kind === "ok") {
        setSpot({ data: r.data, loading: false, error: null, city: r.city, key: r.key, query });
        remember(r.data, r.key, query, r.city);
      } else if (r.kind === "error") setSpot((sp) => ({ ...sp, loading: false, error: r.error, query }));
      else setSpot((sp) => (sp.loading && sp.query === query ? { ...sp, loading: false } : sp));
    },
    [run, remember],
  );
  const showSpot = useCallback(
    (result: SpotResult) => {
      spotAc.current?.abort();
      setSpot({ data: result, loading: false, error: null, city: null, key: null, query: result.label });
      const s = stateRef.current;
      remember(result, signalKey(s), result.label, norm(s.city));
    },
    [remember],
  );

  const loadDecides = useCallback(async () => {
    const c = norm(stateRef.current.city);
    setDecides((d) => ({ ...d, data: d.city === c ? d.data : null, city: c, loading: true, error: null }));
    const r = await run(decidesAc, (s, signal) => api.decides(s, signal));
    if (r.kind === "ok") setDecides({ data: r.data, loading: false, error: null, city: r.city, key: r.key });
    else if (r.kind === "error") setDecides((d) => ({ ...d, loading: false, error: r.error }));
    else setDecides((d) => (d.loading ? { ...d, loading: false } : d));
  }, [run]);
  const showDecides = useCallback((result: DecidesResult) => {
    decidesAc.current?.abort();
    setDecides({ data: result, loading: false, error: null, city: null, key: null });
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
        blend: home.blend,
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
      recentSpots: recent.filter((r) => r.city === city).slice(0, 5).map((r) => ({ ...r, stale: r.key !== key })),
      decides: {
        data: decOk ? decides.data : null,
        loading: decOk && decides.loading,
        error: decOk ? decides.error : null,
        stale: decOk && !!decides.data && decides.key !== null && decides.key !== key,
      },
      loadDecides,
      showDecides,
    };
  }, [city, key, home, findHome, showHome, spot, checkSpot, showSpot, recent, decides, loadDecides, showDecides]);
}

export type Features = ReturnType<typeof useFeaturesStore>;
/** The interface the shell and the assistant code against; extra fields are additions. */
type Contract = {
  home: Load<HomeResult> & { request: { city: string; neighborhood: string } | null };
  findHome(source: HomeSource, blend?: number): Promise<void>;
  showHome(result: HomeResult): void;
  spot: Load<SpotResult> & { query: string | null };
  checkSpot(where: SpotWhere): Promise<void>;
  showSpot(result: SpotResult): void;
  decides: Load<DecidesResult>;
  loadDecides(): Promise<void>;
  showDecides(result: DecidesResult): void;
};
const _contract: (f: Features) => Contract = (f) => f;
void _contract;
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
