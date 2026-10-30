"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type {
  AgentCard,
  AgentEvent,
  Category,
  ExploreState,
  Fingerprint,
  Itinerary,
  Neighborhood,
  Place,
  ResolvedLove,
  StatePatch,
  TasteField,
} from "@/shared/contracts";
import { activeLoves } from "@/shared/contracts";
import type {
  AgentEventV2,
  AreaDecision,
  Constraint,
  GoalState,
  ResultMeta,
  SessionMemory,
  Support,
  VenueEvidence,
  VisitResultV2,
} from "@/shared/contracts-09";
import { emptySessionMemory } from "@/shared/contracts-09";
import { applyPatches } from "@/shared/patches";
import { decodeState, emptyState, encodeState } from "@/lib/state";
import { pickEntity } from "@/lib/pick";
import { api, api2, HomingError, isV2Event, SEARCH_TIMEOUT_MS, streamAgentV2, type AnyAgentEvent } from "./api";
import { areaFromNeighborhood, legacyRules, neighborhoodFromArea, venueFromPlace, visitFromItinerary } from "./adapt";

export type Load<T> = { data: T | null; loading: boolean; error: HomingError | null };
const idle = <T,>(): Load<T> => ({ data: null, loading: false, error: null });

export type ChatTurn = {
  id: number;
  role: "user" | "assistant";
  text: string;
  trace: { tool: string; summary: string }[];
  /** rich results the agent attached to this turn (ranking, home, spot, decides) */
  cards: AgentCard[];
  pending?: boolean;
  error?: string;
  /** the person stopped this answer before it finished */
  stopped?: boolean;
  /** v2: the turn id sent to the server; only events with this id are kept */
  turnId?: string;
  /** v2: every validated event of this turn, in arrival order; F3 derives goals, steps and cards from it */
  events?: AgentEventV2[];
  /** v2: the state revision this turn's results belong to (moves with the agent's own patches) */
  revision?: number;
  /** v2: the person changed the inputs while this turn ran, so its patches were not applied */
  conflict?: boolean;
  /** v2: this assistant turn retries one goal of an earlier turn */
  retryOf?: { turnId: string; goalId: string };
  /** v2: goals as the server last reported them (from plan and done) */
  goals?: GoalState[];
};

/** The analysis behind the map and the shortlist, for one state revision. */
export type Analysis = {
  /** v2 meta; null for a legacy answer */
  meta: ResultMeta | null;
  support: Support | null;
  /** areas in rank order; legacy answers are adapted to neutral ranks */
  areas: AreaDecision[];
  allCandidateIds: string[];
  /** true when the route answered the stage-08 shape */
  legacy: boolean;
  /** the revision this analysis was computed for */
  revision: number;
};

/** "Try this neighborhood": one short visit, with the constraints it was built under. */
export type VisitSlot = Load<VisitResultV2> & {
  /** the inputs or constraints changed since this visit was built */
  stale: boolean;
  areaIds: string[];
  from: "planner" | "assistant";
  legacy: boolean;
  revision: number;
  /** stop ids the person removed or swapped out; never planned again in this visit */
  excludeIds: string[];
  /** first stop, local hour 6..22 (the visit's own; state.startHour stays the multi-day planner's) */
  startHour?: number;
};

/** Which part of the phone sheet the Map screen shows; the tab bar sets it (Map = peek, Shortlist = results). */
export type MobileSheet = "peek" | "results" | "taste";

/** What a screen draws on the shared map, on top of or instead of the taste terrain. */
export type MapOverlay = {
  /** replaces the taste field on the map (Feels like home shows the old neighborhood printed over the new city) */
  field?: TasteField | null;
  /** replaces the ranked neighborhood plates */
  neighborhoods?: Neighborhood[];
  /** a pin for an address */
  pin?: { lon: number; lat: number; label: string } | null;
  /** a walking radius around the pin, metres */
  ring?: { lon: number; lat: number; meters: number } | null;
  /** place dots */
  places?: Place[];
  /** fly the camera here */
  focus?: [number, number] | null;
  /** a click on the map while this overlay is up (for example, check the clicked spot); replaces "open the nearest neighborhood" */
  onMapClick?: (lngLat: [number, number]) => void;
};

/** A love being looked up: searching, or the search failed or ran out of time (kept with its text for Retry). */
export type PendingLove = { status: "searching" | "failed"; query: string; message?: string };
type Pending = Record<string, PendingLove>; // keyed `${target}:${query lower-cased}`

/** Every wait on the client ends: a taste search, a walk, a plan and an assistant turn each have a deadline. */
export const VISIT_TIMEOUT_MS = 60_000;
export const PLAN_TIMEOUT_MS = 60_000;
export const AGENT_CLIENT_TIMEOUT_MS = 90_000;

/** Rules that shaped the current plan and are sent with every re-plan: whole categories and place tags
 *  left out (the assistant's "no museums"). Must-include places live in `include`. */
export type PlanRules = { excludeCategories: Category[]; excludeTags: string[] };
const noRules = (): PlanRules => ({ excludeCategories: [], excludeTags: [] });
/** The options a plan was built with, as the PlanRequest names them. */
export type PlanOptions = { excludeCategories?: Category[]; excludeTags?: string[]; include?: string[] };

export type Toast = { id: number; text: string; undo?: () => void };

const RECENT_KEY = "homing.recent";

/** Signals that change the field; selection and days do not refetch the terrain. */
const fieldKey = (s: ExploreState) =>
  JSON.stringify([
    s.city.trim().toLowerCase(),
    activeLoves(s.loves).map((l) => [l.chosen.id, l.weight]),
    s.refinements.map((t) => t.id),
    Math.round(s.discovery * 20),
    s.companion ? activeLoves(s.companion.loves).map((l) => [l.chosen.id, l.weight]) : null,
  ]);
/** Everything that changes a result: the field signals plus the session constraints. One change = one new revision. */
export const inputKey = (s: ExploreState, constraints: Constraint[]) =>
  // the legacy budget is a hard venue constraint on the server, so it is an input too
  `${fieldKey(s)}|${s.budget ?? ""}|${JSON.stringify([...constraints].sort((a, b) => a.id.localeCompare(b.id)).map((c) => [c.id, c.kind, c.value, c.strength]))}`;

/** The current path with `?s=` set to the state and any other deep-link params (e.g. Home's `from` and `hood`) kept. */
function urlWith(enc: string) {
  const q = new URLSearchParams(window.location.search);
  q.set("s", enc);
  // keep "s" first so shared links read the same as before
  const rest = [...q.entries()].filter(([k]) => k !== "s").map(([k, v]) => `&${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("");
  return `${window.location.pathname}?s=${enc}${rest}`;
}

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
/** A visit starts in the afternoon unless the person picks another time (PlanRequestV2.startHour, 6..22). */
export const VISIT_START_HOUR = 14;
const noVisit = (): VisitSlot => ({ data: null, loading: false, error: null, stale: false, areaIds: [], from: "planner", legacy: false, revision: 0, excludeIds: [] });

function useStore() {
  const [state, setStateRaw] = useState<ExploreState>(() => emptyState());
  const [hydrated, setHydrated] = useState(false);
  const [field, setField] = useState<Load<TasteField>>(idle);
  const [hoods, setHoods] = useState<Load<Neighborhood[]>>(idle);
  const [print, setPrint] = useState<Load<Fingerprint>>(idle);
  const [places, setPlaces] = useState<Load<Place[]>>(idle);
  const [plan, setPlan] = useState<Load<Itinerary>>(idle);
  const planRef = useRef<Itinerary | null>(null);
  planRef.current = plan.data;
  const [pending, setPending] = useState<Pending>({});
  const searchAc = useRef(new Map<string, AbortController>());
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [agentBusy, setAgentBusy] = useState(false);
  const agentBusyRef = useRef(false);
  const chatRef = useRef(chat);
  chatRef.current = chat;
  const [category, setCategory] = useState<Category | "all">("all");
  const [activePlace, setActivePlace] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0); // bump to retry
  const [exclude, setExclude] = useState<string[]>([]);
  const [include, setInclude] = useState<string[]>([]);
  const [saved, setSaved] = useState<Place[]>([]);
  const [openPlace, setOpenPlace] = useState<Place | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [compare, setCompare] = useState<string[]>([]);
  /** where the plan on screen came from: the planner on the Trip screen, or a plan the assistant built */
  const [planFrom, setPlanFrom] = useState<"planner" | "assistant">("planner");
  const [planRules, setPlanRules] = useState<PlanRules>(noRules);
  const planRulesRef = useRef(planRules);
  planRulesRef.current = planRules;
  const [swapping, setSwapping] = useState<string | null>(null);
  const [overlayRaw, setOverlayRaw] = useState<{ o: MapOverlay; path: string } | null>(null);
  const [planDay, setPlanDay] = useState(0);
  const pathname = usePathname() ?? "/explore";
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const agentAbort = useRef<AbortController | null>(null);
  const excludeRef = useRef<string[]>([]);
  const includeRef = useRef<string[]>([]);
  excludeRef.current = exclude;
  includeRef.current = include;
  const stateRef = useRef(state);
  stateRef.current = state;
  /** the city the shown field and ranking belong to; another city's results are never shown as this one's */
  const dataCity = useRef<string | null>(null);
  /** bumps on every plan request and city change, so a late answer for an old request is dropped */
  const planSeq = useRef(0);
  const planAc = useRef<AbortController | null>(null);
  /** bumps when the second person is removed, so their in-flight searches don't bring them back */
  const companionEpoch = useRef(0);

  // hydrate from URL once
  useEffect(() => {
    const s = decodeState(new URLSearchParams(window.location.search).get("s"));
    if (s) setStateRaw(s);
    setHydrated(true);
  }, []);

  // keep URL in sync, remember recent explorations
  // opening a neighborhood is a step the browser's Back button undoes; everything else edits the current entry
  // Back between screens keeps the taste as it is now; Back within one screen (an opened neighborhood) restores that step.
  const lastHood = useRef<string | null | undefined>(undefined);
  const lastPath = useRef<string | null>(null);
  useEffect(() => {
    const onPop = () => {
      if (lastPath.current !== null && window.location.pathname !== lastPath.current) return;
      const s = decodeState(new URLSearchParams(window.location.search).get("s"));
      if (!s) return;
      lastHood.current = s.neighborhood ?? null;
      setStateRaw(s);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  // While the app moves to another screen, the URL sync waits: writing the old path now would cancel the move.
  const navTo = useRef<{ path: string; at: number } | null>(null);
  const beginNav = useCallback((path: string) => {
    navTo.current = { path, at: Date.now() };
  }, []);
  // every screen carries the current state in its URL, whatever link or history entry brought the person there
  useEffect(() => {
    navTo.current = null;
    lastPath.current = pathname;
    if (!hydrated) return;
    const enc = encodeState(stateRef.current);
    if (new URLSearchParams(window.location.search).get("s") !== enc) window.history.replaceState(null, "", urlWith(enc));
  }, [pathname, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    const nav = navTo.current;
    if (nav && nav.path !== window.location.pathname && Date.now() - nav.at < 4000) return;
    const enc = encodeState(state);
    const url = urlWith(enc);
    const hood = state.neighborhood ?? null;
    const deeper = lastHood.current !== undefined && hood !== null && hood !== lastHood.current;
    lastHood.current = hood;
    if (new URLSearchParams(window.location.search).get("s") === enc) {
      /* the URL already says this */
    } else if (deeper) window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
    if (activeLoves(state.loves).length) {
      try {
        const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as { s: string; city: string; loves: string[]; at: number }[];
        const item = { s: enc, city: state.city, loves: activeLoves(state.loves).map((l) => l.chosen.name), at: Date.now() };
        const next = [item, ...list.filter((x) => x.city !== item.city || x.loves.join() !== item.loves.join())].slice(0, 6);
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
    }
  }, [state, hydrated]);

  const patch = useCallback((ops: StatePatch[]) => {
    if (ops.some((op) => op.op === "set_companion" && op.loves === null)) companionEpoch.current++;
    setStateRaw((s) => applyPatches(s, ops));
  }, []);
  const setState = useCallback((fn: (s: ExploreState) => ExploreState) => setStateRaw(fn), []);

  // --- session constraints (the same list the agent receives as memory.constraints)
  const [constraints, setConstraints] = useState<Constraint[]>([]);
  const constraintsRef = useRef(constraints);
  constraintsRef.current = constraints;

  // --- state revision: one authoritative counter. Any change of the inputs (loves, weights, city, crowd, partner,
  // constraints) makes a new revision; a result made for an older revision is stale and never overwrites a newer one.
  // The agent's own patches take the revision the server named (nextRevision), so its later results still match.
  const ik = inputKey(state, constraints);
  const [revision, setRevision] = useState(0);
  const revRef = useRef(0);
  const revKey = useRef<string | null>(null);
  /** bumps only for changes the person made (not the agent); an agent turn that sees it move drops its patches */
  const inputEpoch = useRef(0);
  useEffect(() => {
    if (!hydrated) return;
    if (revKey.current === null || revKey.current === ik) {
      revKey.current = ik;
      return;
    }
    revKey.current = ik;
    revRef.current += 1;
    inputEpoch.current += 1;
    setRevision(revRef.current);
  }, [ik, hydrated]);
  /** Apply a change that the agent made: it takes the server's next revision and does not count as the person's edit. */
  const agentCommit = useCallback((ops: StatePatch[], nextConstraints: Constraint[] | null, nextRevision?: number, opts: { bump?: boolean } = {}) => {
    const s1 = ops.length ? applyPatches(stateRef.current, ops) : stateRef.current;
    const c1 = nextConstraints ?? constraintsRef.current;
    const key = inputKey(s1, c1);
    const bump = opts.bump ?? true;
    if (key !== revKey.current) {
      revKey.current = key;
      if (bump) {
        revRef.current = Math.max(revRef.current + 1, nextRevision ?? 0);
        setRevision(revRef.current);
      }
    } else if (bump && nextRevision !== undefined && nextRevision > revRef.current) {
      // the server moved the revision without changing the inputs: what is on screen still describes them
      const from = revRef.current;
      revRef.current = nextRevision;
      setRevision(nextRevision);
      setAnalysis((a) => (a.data && a.data.revision === from ? { ...a, data: { ...a.data, revision: nextRevision } } : a));
      setVisit((v) => (v.revision === from ? { ...v, revision: nextRevision } : v));
    }
    if (ops.length) {
      stateRef.current = s1;
      setStateRaw(s1);
    }
    if (nextConstraints) {
      constraintsRef.current = c1;
      setConstraints(c1);
    }
  }, []);

  const setConstraint = useCallback((c: Constraint) => {
    setConstraints((list) => [...list.filter((x) => x.id !== c.id), c]);
  }, []);
  const removeConstraint = useCallback((id: string) => {
    setConstraints((list) => list.filter((x) => x.id !== id));
  }, []);

  // --- field + areas + fingerprint, debounced on input changes. Field and areas are asked in parallel; the server
  // shares one analysis between them, and each lands on its own.
  const [analysis, setAnalysis] = useState<Load<Analysis>>(idle);
  const firstAnalysis = useRef(true);
  const fk = fieldKey(state);
  const hasSignals = activeLoves(state.loves).length > 0;
  useEffect(() => {
    if (!hydrated) return;
    if (!hasSignals) {
      setField(idle());
      setHoods(idle());
      setPrint(idle());
      setAnalysis(idle());
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(async () => {
      const s = stateRef.current;
      const rev = revRef.current;
      const env = { stateRevision: rev, constraints: constraintsRef.current };
      const city = s.city.trim().toLowerCase();
      // keep the old terrain on screen while the same city recomputes (marked stale); a new city starts empty
      const fresh = dataCity.current !== city;
      if (fresh) dataCity.current = null;
      setField((f) => ({ data: fresh ? null : f.data, loading: true, error: null }));
      setHoods((h) => ({ data: fresh ? null : h.data, loading: true, error: null }));
      setAnalysis((a) => ({ data: fresh ? null : a.data, loading: true, error: null }));
      setPrint((p) => ({ ...p, loading: true, error: null }));
      const current = () => !ac.signal.aborted && revRef.current === rev;
      api.fingerprint(s, ac.signal).then(
        (data) => current() && setPrint({ data, loading: false, error: null }),
        (e: HomingError) => e.code !== "aborted" && setPrint((p) => ({ ...p, loading: false, error: e })),
      );
      const fieldDone = api2.field(s, env, ac.signal).then(
        (r) => {
          if (!current()) return false;
          if (r.v === 2 && r.data.meta.stateRevision !== rev) return false;
          dataCity.current = city;
          setField({ data: r.v === 2 ? r.data.field : r.data, loading: false, error: null });
          return true;
        },
        (e: HomingError) => {
          if (e.code === "aborted" || !current()) return false;
          setField((f) => ({ ...f, loading: false, error: e }));
          return false;
        },
      );
      try {
        const r = await api2.areas(s, env, ac.signal);
        if (!current()) return;
        let a: Analysis;
        if (r.v === 2) {
          if (r.data.meta.stateRevision !== rev) return;
          const areas = [...r.data.areas].sort((x, y) => x.metrics.rank - y.metrics.rank);
          a = { meta: r.data.meta, support: null, areas, allCandidateIds: r.data.allCandidateIds, legacy: false, revision: rev };
        } else {
          const list = r.data.neighborhoods;
          a = { meta: null, support: null, areas: list.map((n) => areaFromNeighborhood(n, list)), allCandidateIds: list.map((n) => n.id), legacy: true, revision: rev };
        }
        setAnalysis({ data: a, loading: false, error: null });
        setHoods({ data: r.v === 2 ? a.areas.map(neighborhoodFromArea) : r.data.neighborhoods, loading: false, error: null });
        // keep the selection if it still exists, otherwise clear it
        if (s.neighborhood && !a.areas.some((x) => x.area.id === s.neighborhood)) patch([{ op: "select_neighborhood", id: null }]);
      } catch (e) {
        const err = e as HomingError;
        if (err.code === "aborted" || !current()) return;
        // a failed field explains a failed ranking better than the ranking's own error
        const fieldOk = await fieldDone;
        if (!current()) return;
        setHoods((h) => ({ data: fieldOk ? h.data : null, loading: false, error: err }));
        setAnalysis((x) => ({ data: fieldOk ? x.data : null, loading: false, error: err }));
      }
    }, firstAnalysis.current ? 0 : 350);
    // the first analysis after opening the page starts at once; later edits are debounced
    firstAnalysis.current = false;
    return () => {
      clearTimeout(t);
      ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ik, hydrated, nonce]);

  // --- places of the selected area
  const selected = hoods.data?.find((n) => n.id === state.neighborhood) ?? null;
  const selectedArea = analysis.data?.areas.find((a) => a.area.id === state.neighborhood) ?? null;
  const [venues, setVenues] = useState<Load<VenueEvidence[]>>(idle);
  useEffect(() => {
    setActivePlace(null);
    if (!selected) {
      setPlaces(idle());
      setVenues(idle());
      setPlan(idle());
      return;
    }
    const ac = new AbortController();
    const rev = revRef.current;
    setPlaces((p) => ({ data: p.data, loading: true, error: null }));
    setVenues((v) => ({ data: v.data, loading: true, error: null }));
    setPlan(idle());
    api2.places(stateRef.current, { stateRevision: rev, constraints: constraintsRef.current, areaId: selected.id }, ac.signal).then(
      (r) => {
        if (ac.signal.aborted || revRef.current !== rev) return;
        const list = r.v === 2 ? r.data.venues : r.data.places.map(venueFromPlace);
        setVenues({ data: list, loading: false, error: null });
        setPlaces({ data: list.map((v) => v.place), loading: false, error: null });
      },
      (e: HomingError) => {
        if (e.code === "aborted" || ac.signal.aborted) return;
        setPlaces({ data: null, loading: false, error: e });
        setVenues({ data: null, loading: false, error: e });
      },
    );
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, ik, nonce, state.budget]);

  const makePlan = useCallback(async (opts: { exclude?: string[]; include?: string[]; rules?: PlanRules } = {}) => {
    const s = stateRef.current;
    const ex = opts.exclude ?? excludeRef.current;
    const inc = opts.include ?? includeRef.current;
    const rules = opts.rules ?? planRulesRef.current;
    const ranked = hoods.data ?? [];
    if (!s.neighborhood && !ranked.length) return;
    const first = s.neighborhood ?? ranked[0].id;
    const rest = ranked.filter((n) => n.id !== first).map((n) => n.id);
    const ids = [first, ...rest].slice(0, s.days);
    const seq = ++planSeq.current;
    planAc.current?.abort();
    const ac = new AbortController();
    planAc.current = ac;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ac.abort();
    }, PLAN_TIMEOUT_MS);
    // the plan on screen stays (dimmed) until the new one arrives
    setPlan((p) => ({ data: p.data, loading: true, error: null }));
    try {
      const data = await api.plan(s, ids, { exclude: ex, include: inc, excludeCategories: rules.excludeCategories, excludeTags: rules.excludeTags }, ac.signal);
      if (seq === planSeq.current) {
        setPlanFrom("planner");
        setPlan({ data, loading: false, error: null });
        setPlanDay((d) => (d < data.days.length ? d : 0));
      }
    } catch (e) {
      if (seq !== planSeq.current) return;
      const err = timedOut
        ? new HomingError("qloo_unavailable", `Planning took longer than ${PLAN_TIMEOUT_MS / 1000} s, so it was stopped. Try again.`, true)
        : (e as HomingError);
      setPlan((p) => ({ data: p.data, loading: false, error: err.code === "aborted" ? null : err }));
    } finally {
      clearTimeout(timer);
      if (seq === planSeq.current && planAc.current === ac) planAc.current = null;
    }
  }, [hoods.data]);
  /** Stop waiting for the plan; the previous plan stays. */
  const cancelPlan = useCallback(() => {
    planSeq.current++;
    planAc.current?.abort();
    planAc.current = null;
    setPlan((p) => ({ ...p, loading: false, error: null }));
  }, []);

  // re-plan when trip settings change and a plan exists
  const hadPlan = !!plan.data;
  useEffect(() => {
    if (hadPlan) void makePlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.days, state.pace, state.startHour, state.budget]);

  // a new city starts with a clean slate of plan edits
  useEffect(() => {
    planSeq.current++;
    planAc.current?.abort();
    setPlan(idle());
    setExclude([]);
    setInclude([]);
    setPlanRules(noRules());
    setOpenPlace(null);
    setCompare([]);
    visitSeq.current++;
    visitAc.current?.abort();
    setVisit(noVisit());
  }, [state.city]);

  const notify = useCallback((text: string, undo?: () => void) => {
    setToast({ id: Date.now(), text, undo });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast((cur) => (cur?.id === toast.id ? null : cur)), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  // shortlist lives per city in this browser
  const savedKey = `homing.saved.${state.city.toLowerCase()}`;
  useEffect(() => {
    try {
      setSaved(JSON.parse(localStorage.getItem(savedKey) ?? "[]") as Place[]);
    } catch {
      setSaved([]);
    }
  }, [savedKey]);
  const persistSaved = useCallback(
    (list: Place[]) => {
      setSaved(list);
      try {
        localStorage.setItem(savedKey, JSON.stringify(list));
      } catch {
        /* storage unavailable */
      }
    },
    [savedKey],
  );
  const isSaved = useCallback((id: string) => saved.some((p) => p.id === id), [saved]);
  const toggleSave = useCallback(
    (p: Place) => {
      if (saved.some((x) => x.id === p.id)) {
        const before = saved;
        persistSaved(saved.filter((x) => x.id !== p.id));
        notify(`Removed ${p.name} from your shortlist`, () => persistSaved(before));
      } else {
        persistSaved([p, ...saved].slice(0, 24));
        notify(`Saved ${p.name} to your shortlist`);
      }
    },
    [saved, persistSaved, notify],
  );

  /** Replace one stop: plan again without it; the solver keeps the other stops where it can. */
  const swapStop = useCallback(
    async (placeId: string) => {
      const next = [...new Set([...excludeRef.current, placeId])];
      const inc = includeRef.current.filter((id) => id !== placeId);
      setExclude(next);
      setInclude(inc);
      setSwapping(placeId);
      await makePlan({ exclude: next, include: inc });
      setSwapping(null);
    },
    [makePlan],
  );
  const addToPlan = useCallback(
    async (p: Place) => {
      const inc = [...new Set([...includeRef.current, p.id])];
      const ex = excludeRef.current.filter((id) => id !== p.id);
      setInclude(inc);
      setExclude(ex);
      await makePlan({ include: inc, exclude: ex });
      notify(`${p.name} is in your plan`);
    },
    [makePlan, notify],
  );
  const planWithSaved = useCallback(async () => {
    const inc = [...new Set([...includeRef.current, ...saved.map((p) => p.id)])].slice(0, 12);
    setInclude(inc);
    await makePlan({ include: inc });
  }, [makePlan, saved]);

  /** A plan the assistant built, opened on the Trip screen as the current plan, with the rules it was built with
   *  so that Plan again and changing days, pace or start keep them. */
  const showPlan = useCallback((itinerary: Itinerary, options: PlanOptions = {}) => {
    planSeq.current++;
    setExclude([]);
    setInclude([...new Set(options.include ?? [])].slice(0, 12));
    setPlanRules({ excludeCategories: [...new Set(options.excludeCategories ?? [])], excludeTags: [...new Set(options.excludeTags ?? [])] });
    setPlan({ data: itinerary, loading: false, error: null });
    setPlanDay(0);
    setPlanFrom("assistant");
  }, []);

  /** Take one rule off the plan and plan again without it. */
  const removePlanRule = useCallback(
    async (rule: { kind: "category"; value: Category } | { kind: "tag"; value: string } | { kind: "include"; value: string }) => {
      if (rule.kind === "include") {
        const inc = includeRef.current.filter((id) => id !== rule.value);
        setInclude(inc);
        if (planRef.current) await makePlan({ include: inc });
        return;
      }
      const cur = planRulesRef.current;
      const next: PlanRules =
        rule.kind === "category"
          ? { ...cur, excludeCategories: cur.excludeCategories.filter((c) => c !== rule.value) }
          : { ...cur, excludeTags: cur.excludeTags.filter((t) => t !== rule.value) };
      setPlanRules(next);
      if (planRef.current) await makePlan({ rules: next });
    },
    [makePlan],
  );

  // --- "Try this neighborhood": one short visit under the session constraints
  const [visit, setVisit] = useState<VisitSlot>(noVisit);
  const visitRef = useRef(visit);
  visitRef.current = visit;
  const visitSeq = useRef(0);
  const visitAc = useRef<AbortController | null>(null);
  const requestVisit = useCallback(
    async (areaIds: string[], opts: { includeIds?: string[]; excludeIds?: string[]; replacePlaceId?: string; from?: VisitSlot["from"]; startHour?: number } = {}) => {
      const ids = [...new Set(areaIds)].slice(0, 3);
      if (!ids.length) return;
      const s = stateRef.current;
      const cons = constraintsRef.current;
      const rev = revRef.current;
      const seq = ++visitSeq.current;
      visitAc.current?.abort();
      const ac = new AbortController();
      visitAc.current = ac;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        ac.abort();
      }, VISIT_TIMEOUT_MS);
      const excludeIds = [...new Set(opts.excludeIds ?? (visitRef.current.areaIds.join() === ids.join() ? visitRef.current.excludeIds : []))].slice(0, 100);
      const prior = opts.replacePlaceId ? visitRef.current.data?.itinerary : undefined;
      // the visit keeps the start hour it was built with when it is swapped or re-planned
      const startHour = opts.startHour ?? visitRef.current.startHour ?? VISIT_START_HOUR;
      setVisit((v) => ({ ...v, loading: true, error: null, areaIds: ids, excludeIds, from: opts.from ?? "planner", startHour }));
      const rules = legacyRules(cons);
      // "Try this neighborhood" is one relaxed day of three or four stops; the multi-day planner keeps its own days/pace
      const visitState: ExploreState = { ...s, days: 1, pace: "relaxed" };
      const legacyState = rules.budget !== null ? { ...visitState, budget: s.budget ? Math.min(s.budget, rules.budget) : rules.budget } : visitState;
      try {
        const r = await api2.plan(
          legacyState,
          {
            stateRevision: rev,
            constraints: cons,
            areaIds: ids,
            includeIds: opts.includeIds ?? [],
            excludeIds,
            ...(prior ? { existingItinerary: prior, replacePlaceId: opts.replacePlaceId } : {}),
            ...(startHour !== undefined ? { startHour } : {}),
          },
          { excludeCategories: rules.excludeCategories, excludeTags: rules.excludeTags },
          ac.signal,
        );
        if (seq !== visitSeq.current) return;
        if (r.v === 2 && r.data.meta.stateRevision !== rev) return;
        const data = r.v === 2 ? r.data : visitFromItinerary(r.data, cons);
        setVisit({ data, loading: false, error: null, stale: false, areaIds: ids, from: opts.from ?? "planner", legacy: r.v === 1, revision: rev, excludeIds, startHour });
      } catch (e) {
        if (seq !== visitSeq.current) return;
        // a cancelled walk keeps the last one on screen; a walk that ran out of time says so and can be retried
        const err = timedOut
          ? new HomingError("qloo_unavailable", `Planning the walk took longer than ${VISIT_TIMEOUT_MS / 1000} s, so it was stopped. The last walk is kept. Try again, or pick another time or area.`, true)
          : (e as HomingError);
        setVisit((v) => ({ ...v, loading: false, error: err.code === "aborted" ? null : err }));
      } finally {
        clearTimeout(timer);
        // the controls come back whatever happened to this request
        if (seq === visitSeq.current) {
          if (visitAc.current === ac) visitAc.current = null;
          setVisit((v) => (v.loading ? { ...v, loading: false } : v));
        }
      }
    },
    [setVisit],
  );
  /** Stop waiting for the walk being planned; the last walk stays and the controls come back. */
  const cancelVisit = useCallback(() => {
    visitSeq.current++;
    visitAc.current?.abort();
    visitAc.current = null;
    setVisit((v) => ({ ...v, loading: false, error: null }));
  }, [setVisit]);
  /** Build a short visit of one area (or keep the current visit's areas when called again). */
  const buildVisit = useCallback(
    (areaId: string, opts: { includeIds?: string[]; excludeIds?: string[]; startHour?: number } = {}) =>
      requestVisit([areaId], { ...opts, excludeIds: opts.excludeIds ?? [], from: "planner" }),
    [requestVisit],
  );
  /** A visit the assistant built, opened as the current one with the constraints it was built under. */
  const openVisit = useCallback(
    (result: VisitResultV2, areaIds: string[]) => {
      visitSeq.current++;
      visitAc.current?.abort();
      const cons = result.constraints;
      // the plan's constraints become the session's, so Plan again and Swap keep them
      agentCommit([], cons);
      // swaps and re-plans keep the hour the assistant's walk starts at
      const first = result.itinerary.days[0]?.stops[0]?.time;
      const hour = first ? Number.parseInt(first, 10) : NaN;
      const startHour = Number.isFinite(hour) && hour >= 6 && hour <= 22 ? hour : undefined;
      setVisit({ data: result, loading: false, error: null, stale: false, areaIds, from: "assistant", legacy: false, revision: revRef.current, excludeIds: [], startHour });
    },
    [agentCommit, setVisit],
  );
  const stopIds = (v: VisitResultV2 | null) => (v ? v.itinerary.days.flatMap((d) => d.stops.map((st) => st.place.id)) : []);
  /** Replace one stop; every other stop id is kept. */
  const swapVisitStop = useCallback(
    async (placeId: string) => {
      const v = visitRef.current;
      if (!v.data) return;
      const keep = stopIds(v.data).filter((id) => id !== placeId);
      await requestVisit(v.areaIds, { includeIds: keep, excludeIds: [...v.excludeIds, placeId], replacePlaceId: placeId, from: v.from });
    },
    [requestVisit],
  );
  /** Remove one stop without asking for a replacement: it goes into the exclusion memory and the rest stay. */
  const removeVisitStop = useCallback(
    async (placeId: string) => {
      const v = visitRef.current;
      if (!v.data) return;
      const keep = stopIds(v.data).filter((id) => id !== placeId);
      await requestVisit(v.areaIds, { includeIds: keep, excludeIds: [...v.excludeIds, placeId], from: v.from });
    },
    [requestVisit],
  );
  // a visit made for older inputs is stale; when the constraints change and a visit is open, plan it again with them
  const visitStale = !!visit.data && visit.revision !== revision;
  const consKey = JSON.stringify(constraints);
  const lastConsKey = useRef(consKey);
  useEffect(() => {
    if (lastConsKey.current === consKey) return;
    lastConsKey.current = consKey;
    const v = visitRef.current;
    // the old stops are not forced back in: a new rule may exclude one of them
    if (v.data && v.areaIds.length) void requestVisit(v.areaIds, { excludeIds: v.excludeIds, from: v.from });
  }, [consKey, requestVisit]);

  // --- loves
  const addLove = useCallback(
    async (query: string, target: "you" | "them" = "you") => {
      const q = query.trim().slice(0, 120);
      if (!q) return;
      const key = `${target}:${q.toLowerCase()}`;
      const epoch = companionEpoch.current;
      // one search per love: a retry replaces the earlier one, and Remove aborts it
      searchAc.current.get(key)?.abort();
      const ac = new AbortController();
      searchAc.current.set(key, ac);
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        ac.abort();
      }, SEARCH_TIMEOUT_MS);
      setPending((p) => ({ ...p, [key]: { status: "searching", query: q } }));
      let love: ResolvedLove | null = null;
      let failure: string | null = null;
      try {
        const results = await api.search(q, undefined, ac.signal);
        // no match is an answer (the chip says "Not in the taste graph"); a failed search is not
        love = { query: q, chosen: pickEntity(q, results), candidates: results, weight: 1 };
      } catch (e) {
        failure = timedOut ? `No answer from the taste search in ${SEARCH_TIMEOUT_MS / 1000} s.` : (e as Error).message || "The taste search failed.";
      } finally {
        clearTimeout(timer);
      }
      // removed, or searched again, while this one ran: its answer is dropped
      if (searchAc.current.get(key) !== ac) return;
      searchAc.current.delete(key);
      if (!love) {
        setPending((p) => ({ ...p, [key]: { status: "failed", query: q, message: failure ?? undefined } }));
        return;
      }
      setPending((p) => {
        const n = { ...p };
        delete n[key];
        return n;
      });
      if (target === "you") patch([{ op: "add_love", love }]);
      else if (epoch === companionEpoch.current)
        setStateRaw((s) => {
          const cur = s.companion?.loves ?? [];
          if (cur.some((l) => l.query.toLowerCase() === q.toLowerCase())) return s;
          return applyPatches(s, [{ op: "set_companion", loves: [...cur, love] }]);
        });
    },
    [patch],
  );

  /** Take a love that is still being looked up (or whose search failed) off the list; never blocked by the search. */
  const removePending = useCallback((query: string, target: "you" | "them" = "you") => {
    const key = `${target}:${query.trim().slice(0, 120).toLowerCase()}`;
    searchAc.current.get(key)?.abort();
    searchAc.current.delete(key);
    setPending((p) => {
      const n = { ...p };
      delete n[key];
      return n;
    });
  }, []);

  const addResolved = useCallback(
    (loves: ResolvedLove[], target: "you" | "them" = "you") => {
      if (target === "you") patch(loves.map((love) => ({ op: "add_love" as const, love })));
      else setStateRaw((s) => applyPatches(s, [{ op: "set_companion", loves: [...(s.companion?.loves ?? []), ...loves] }]));
    },
    [patch],
  );

  const updateLove = useCallback((target: "you" | "them", query: string, fn: (l: ResolvedLove) => ResolvedLove | null) => {
    const s0 = stateRef.current;
    const removed = (target === "you" ? s0.loves : s0.companion?.loves ?? []).find((l) => l.query === query && fn(l) === null);
    if (removed) notify(`Removed ${removed.chosen?.name ?? removed.query}`, () => setStateRaw(s0));
    setStateRaw((s) => {
      const list = target === "you" ? s.loves : s.companion?.loves ?? [];
      const next = list.map((l) => (l.query === query ? fn(l) : l)).filter(Boolean) as ResolvedLove[];
      if (target === "you") return { ...s, loves: next };
      return { ...s, companion: next.length || s.companion ? { loves: next } : null };
    });
  }, [notify]);

  /** Restore the "did you mean" list for a love that arrived through a shared link. */
  const loadCandidates = useCallback(async (target: "you" | "them", query: string) => {
    try {
      const results = await api.search(query);
      if (results.length < 2) return;
      setStateRaw((s) => {
        const fill = (list: ResolvedLove[]) => list.map((l) => (l.query === query && l.candidates.length <= 1 ? { ...l, candidates: results } : l));
        if (target === "you") return { ...s, loves: fill(s.loves) };
        return s.companion ? { ...s, companion: { loves: fill(s.companion.loves) } } : s;
      });
    } catch {
      /* the menu still works without alternatives */
    }
  }, []);

  // --- agent (v2 turn protocol, with the v1 events still understood while the route moves over)
  const sessionId = useRef<string>("");
  const memoryRef = useRef<SessionMemory>(emptySessionMemory());
  const runTurn = useCallback(
    async (text: string, opts: { retryOf?: { turnId: string; goalId: string } } = {}) => {
      if (!text || agentBusyRef.current) return;
      if (!sessionId.current) sessionId.current = newId();
      const uid = Date.now();
      const turnId = newId();
      const history = chatRef.current
        .filter((t) => t.text)
        .slice(-8)
        .map((t) => ({ role: t.role, content: t.text.slice(0, 6000) }));
      const startRev = revRef.current;
      const startEpoch = inputEpoch.current;
      setChat((c) => [
        ...c,
        ...(opts.retryOf ? [] : [{ id: uid, role: "user" as const, text, trace: [], cards: [] }]),
        { id: uid + 1, role: "assistant", text: "", trace: [], cards: [], pending: true, turnId, events: [], revision: startRev, ...(opts.retryOf ? { retryOf: opts.retryOf } : {}) },
      ]);
      agentBusyRef.current = true;
      setAgentBusy(true);
      const ac = new AbortController();
      agentAbort.current = ac;
      // a backstop over the server's own limit: the turn always ends, and what already arrived stays
      let timedOut = false;
      const deadline = setTimeout(() => {
        timedOut = true;
        ac.abort();
      }, AGENT_CLIENT_TIMEOUT_MS);
      const upd = (fn: (t: ChatTurn) => ChatTurn) => setChat((c) => c.map((t) => (t.id === uid + 1 ? fn(t) : t)));
      /** the person changed the inputs after this turn started: its patches would overwrite newer choices */
      const overtaken = () => inputEpoch.current !== startEpoch;
      const memory: SessionMemory = { ...memoryRef.current, revision: startRev, constraints: constraintsRef.current.slice(0, 40) };
      await streamAgentV2(
        {
          responseVersion: 2,
          sessionId: sessionId.current,
          turnId,
          stateRevision: startRev,
          state: stateRef.current,
          memory,
          message: text,
          history: history.slice(-20),
          ...(opts.retryOf ? { retryGoalId: opts.retryOf.goalId } : {}),
        },
        (e: AnyAgentEvent) => {
          if (ac.signal.aborted) return;
          if (isV2Event(e)) {
            if (e.turnId !== turnId) return; // another turn's event never lands here
            if (e.type === "patch") {
              if (overtaken() || e.baseRevision !== revRef.current) {
                upd((t) => ({ ...t, conflict: true, events: [...(t.events ?? []), e] }));
                return;
              }
              // ops and constraints land together with the server's revision, before any card of this turn
              agentCommit(e.ops, e.constraints ?? null, e.nextRevision);
              upd((t) => ({ ...t, revision: revRef.current, events: [...(t.events ?? []), e] }));
              return;
            }
            if (e.type === "done") {
              memoryRef.current = e.memory;
              // the constraints already came with the patch events; done only records memory and never adds a revision
              if (!overtaken()) agentCommit([], e.memory.constraints, undefined, { bump: false });
              upd((t) => ({ ...t, pending: false, goals: e.goals, revision: revRef.current, events: [...(t.events ?? []), e] }));
              return;
            }
            if (e.type === "plan") {
              upd((t) => ({ ...t, goals: e.goals, events: [...(t.events ?? []), e] }));
              return;
            }
            if (e.type === "answer") {
              upd((t) => ({ ...t, text: e.claims.map((c) => c.text).join(" "), events: [...(t.events ?? []), e] }));
              return;
            }
            if (e.type === "error") {
              // an error tied to one goal leaves the rest of the turn running; a turn-level error ends it
              upd((t) => ({ ...t, ...(e.goalId ? {} : { pending: false, error: e.message }), events: [...(t.events ?? []), e] }));
              return;
            }
            upd((t) => ({ ...t, events: [...(t.events ?? []), e] }));
            return;
          }
          // v1 events
          if (e.type === "trace") upd((t) => ({ ...t, trace: [...t.trace, { tool: e.tool, summary: e.summary }] }));
          else if (e.type === "patch") {
            if (overtaken()) upd((t) => ({ ...t, conflict: true }));
            else {
              agentCommit(e.ops, null);
              upd((t) => ({ ...t, revision: revRef.current }));
            }
          } else if (e.type === "delta") upd((t) => ({ ...t, text: t.text + e.text }));
          // one card per kind per turn: a later ranking replaces the earlier one
          else if (e.type === "card") upd((t) => ({ ...t, cards: [...t.cards.filter((c) => c.kind !== e.card.kind), e.card] }));
          else if (e.type === "error") upd((t) => ({ ...t, pending: false, error: e.error.message }));
          else if (e.type === "done") upd((t) => ({ ...t, pending: false }));
        },
        ac.signal,
      );
      clearTimeout(deadline);
      upd((t) =>
        timedOut && t.pending
          ? { ...t, pending: false, error: t.error ?? `No final answer after ${AGENT_CLIENT_TIMEOUT_MS / 1000} s, so Homing stopped waiting. Anything that already arrived is kept above. Try again.` }
          : { ...t, pending: false, stopped: ac.signal.aborted && !t.error ? true : t.stopped },
      );
      if (agentAbort.current === ac) agentAbort.current = null;
      agentBusyRef.current = false;
      setAgentBusy(false);
    },
    [agentCommit],
  );
  const askAgent = useCallback((message: string) => runTurn(message.trim().slice(0, 1000)), [runTurn]);
  /** Run one failed or partial goal of an earlier turn again; the other results of that turn stay. */
  const retryGoal = useCallback(
    async (turnId: string, goalId: string) => {
      const list = chatRef.current;
      const i = list.findIndex((t) => t.turnId === turnId);
      if (i < 0) return;
      // the question that started that turn (a retry turn points at the original)
      const origin = list[i].retryOf ? list.findIndex((t) => t.turnId === list[i].retryOf?.turnId) : i;
      const user = list.slice(0, origin < 0 ? i : origin).reverse().find((t) => t.role === "user");
      if (!user) return;
      await runTurn(user.text, { retryOf: { turnId, goalId } });
    },
    [runTurn],
  );
  /** Whether a turn's results were made for older inputs than the ones on screen now. */
  const isTurnStale = useCallback((t: ChatTurn) => t.role === "assistant" && t.revision !== undefined && !t.pending && t.revision !== revision, [revision]);
  const stopAgent = useCallback(() => agentAbort.current?.abort(), []);
  const clearChat = useCallback(() => {
    agentAbort.current?.abort();
    setChat([]);
    // a new conversation starts with fresh goals; the constraints stay, they are the person's
    memoryRef.current = emptySessionMemory(revRef.current);
  }, []);

  /** Drop a place from the session: never suggested again in this visit or by the assistant. */
  const removePlace = useCallback(
    (id: string) => {
      const m = memoryRef.current;
      memoryRef.current = { ...m, rejectedPlaceIds: [...new Set([...m.rejectedPlaceIds, id])].slice(-100) };
      if (stopIds(visitRef.current.data).includes(id)) void removeVisitStop(id);
      else setVisit((v) => (v.excludeIds.includes(id) ? v : { ...v, excludeIds: [...v.excludeIds, id].slice(-100) }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [removeVisitStop],
  );

  // --- phone sheet: the tab bar opens the Map peeked or the shortlist; the Map screen reads it
  const [mobileSheet, setMobileSheet] = useState<MobileSheet>("results");
  /** a line from Homing in the conversation that did not come from the agent, e.g. what a screenshot added */
  const addNote = useCallback((text: string) => {
    setChat((c) => [...c, { id: Date.now(), role: "assistant", text, trace: [], cards: [] }]);
  }, []);

  // --- map overlay: it belongs to the screen that set it, so an overlay a screen forgot to clear never leaks onto another
  const setOverlay = useCallback((o: MapOverlay | null) => setOverlayRaw(o ? { o, path: pathRef.current } : null), []);
  const overlay = overlayRaw && overlayRaw.path === pathname ? overlayRaw.o : null;

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  const visiblePlaces = useMemo(
    () => {
      const list = (places.data ?? []).filter((p) => category === "all" || p.category === category);
      // a place can qualify for two categories; show it once
      const seen = new Set<string>();
      return list.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
    },
    [places.data, category],
  );

  return {
    // stage 09
    revision,
    analysis,
    selectedArea,
    venues,
    constraints,
    setConstraint,
    removeConstraint,
    visit: { ...visit, stale: visitStale },
    buildVisit,
    openVisit,
    swapVisitStop,
    removeVisitStop,
    removePlace,
    retryGoal,
    isTurnStale,
    mobileSheet,
    setMobileSheet,
    // stage 08 (kept while screens move over)
    beginNav,
    overlay,
    setOverlay,
    planDay,
    setPlanDay,
    stopAgent,
    clearChat,
    addNote,
    pathname,
    exclude,
    include,
    saved,
    isSaved,
    toggleSave,
    planWithSaved,
    openPlace,
    setOpenPlace,
    toast,
    setToast,
    notify,
    swapStop,
    swapping,
    addToPlan,
    compare,
    setCompare,
    showPlan,
    planFrom,
    planRules,
    removePlanRule,
    state,
    hydrated,
    patch,
    setState,
    field,
    hoods,
    print,
    places,
    visiblePlaces,
    plan,
    makePlan,
    selected,
    pending,
    addLove,
    removePending,
    cancelVisit,
    cancelPlan,
    addResolved,
    updateLove,
    loadCandidates,
    chat,
    agentBusy,
    askAgent,
    category,
    setCategory,
    activePlace,
    setActivePlace,
    retry,
  };
}

export type ExploreStore = ReturnType<typeof useStore>;
const Ctx = createContext<ExploreStore | null>(null);

export function ExploreProvider({ children }: { children: React.ReactNode }) {
  const store = useStore();
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useExplore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useExplore outside ExploreProvider");
  return s;
}
