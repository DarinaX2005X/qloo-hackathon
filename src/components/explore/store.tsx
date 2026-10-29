"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type {
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
import { applyPatches } from "@/shared/patches";
import { decodeState, emptyState, encodeState } from "@/lib/state";
import { pickEntity } from "@/lib/pick";
import { api, HomingError, streamAgent } from "./api";

export type Load<T> = { data: T | null; loading: boolean; error: HomingError | null };
const idle = <T,>(): Load<T> => ({ data: null, loading: false, error: null });

export type ChatTurn = {
  id: number;
  role: "user" | "assistant";
  text: string;
  trace: { tool: string; summary: string }[];
  pending?: boolean;
  error?: string;
};

type Pending = Record<string, true>; // queries being looked up

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

function useStore() {
  const [state, setStateRaw] = useState<ExploreState>(() => emptyState());
  const [hydrated, setHydrated] = useState(false);
  const [field, setField] = useState<Load<TasteField>>(idle);
  const [hoods, setHoods] = useState<Load<Neighborhood[]>>(idle);
  const [print, setPrint] = useState<Load<Fingerprint>>(idle);
  const [places, setPlaces] = useState<Load<Place[]>>(idle);
  const [plan, setPlan] = useState<Load<Itinerary>>(idle);
  const [pending, setPending] = useState<Pending>({});
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [agentBusy, setAgentBusy] = useState(false);
  const [category, setCategory] = useState<Category | "all">("all");
  const [activePlace, setActivePlace] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0); // bump to retry
  const stateRef = useRef(state);
  stateRef.current = state;

  // hydrate from URL once
  useEffect(() => {
    const s = decodeState(new URLSearchParams(window.location.search).get("s"));
    if (s) setStateRaw(s);
    setHydrated(true);
  }, []);

  // keep URL in sync, remember recent explorations
  useEffect(() => {
    if (!hydrated) return;
    const enc = encodeState(state);
    const url = `${window.location.pathname}?s=${enc}`;
    window.history.replaceState(null, "", url);
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

  const patch = useCallback((ops: StatePatch[]) => setStateRaw((s) => applyPatches(s, ops)), []);
  const setState = useCallback((fn: (s: ExploreState) => ExploreState) => setStateRaw(fn), []);

  // --- field + neighborhoods + fingerprint, debounced on signal changes
  const fk = fieldKey(state);
  const hasSignals = activeLoves(state.loves).length > 0;
  useEffect(() => {
    if (!hydrated) return;
    if (!hasSignals) {
      setField(idle());
      setHoods(idle());
      setPrint(idle());
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(async () => {
      const s = stateRef.current;
      setField((f) => ({ ...f, loading: true, error: null }));
      setHoods((h) => ({ ...h, loading: true, error: null }));
      setPrint((p) => ({ ...p, loading: true, error: null }));
      api.fingerprint(s, ac.signal).then(
        (data) => setPrint({ data, loading: false, error: null }),
        (e: HomingError) => e.code !== "aborted" && setPrint((p) => ({ ...p, loading: false, error: e })),
      );
      try {
        const f = await api.field(s, ac.signal);
        setField({ data: f, loading: false, error: null });
      } catch (e) {
        const err = e as HomingError;
        if (err.code === "aborted") return;
        setField((f) => ({ ...f, loading: false, error: err }));
      }
      try {
        const n = await api.neighborhoods(s, ac.signal);
        setHoods({ data: n, loading: false, error: null });
        // keep the selection if it still exists, otherwise clear it
        if (s.neighborhood && !n.some((x) => x.id === s.neighborhood)) patch([{ op: "select_neighborhood", id: null }]);
      } catch (e) {
        const err = e as HomingError;
        if (err.code !== "aborted") setHoods((h) => ({ ...h, loading: false, error: err }));
      }
    }, 350);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fk, hydrated, nonce]);

  // --- places of the selected neighborhood
  const selected = hoods.data?.find((n) => n.id === state.neighborhood) ?? null;
  useEffect(() => {
    setActivePlace(null);
    if (!selected) {
      setPlaces(idle());
      setPlan(idle());
      return;
    }
    const ac = new AbortController();
    setPlaces((p) => ({ data: p.data, loading: true, error: null }));
    setPlan(idle());
    api.places(stateRef.current, selected.id, undefined, ac.signal).then(
      (data) => setPlaces({ data, loading: false, error: null }),
      (e: HomingError) => e.code !== "aborted" && setPlaces({ data: null, loading: false, error: e }),
    );
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, fk, nonce]);

  const makePlan = useCallback(async () => {
    const s = stateRef.current;
    const ranked = hoods.data ?? [];
    if (!s.neighborhood && !ranked.length) return;
    const first = s.neighborhood ?? ranked[0].id;
    const rest = ranked.filter((n) => n.id !== first).map((n) => n.id);
    const ids = [first, ...rest].slice(0, s.days);
    setPlan({ data: null, loading: true, error: null });
    try {
      setPlan({ data: await api.plan(s, ids), loading: false, error: null });
    } catch (e) {
      setPlan({ data: null, loading: false, error: e as HomingError });
    }
  }, [hoods.data]);

  // re-plan when days change and a plan exists
  const days = state.days;
  const hadPlan = !!plan.data;
  useEffect(() => {
    if (hadPlan) void makePlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  // --- loves
  const addLove = useCallback(
    async (query: string, target: "you" | "them" = "you") => {
      const q = query.trim();
      if (!q) return;
      const key = `${target}:${q.toLowerCase()}`;
      setPending((p) => ({ ...p, [key]: true }));
      let love: ResolvedLove = { query: q, chosen: null, candidates: [], weight: 1 };
      try {
        const results = await api.search(q);
        love = { query: q, chosen: pickEntity(q, results), candidates: results, weight: 1 };
      } catch {
        /* keep unresolved; the chip explains */
      }
      setPending((p) => {
        const n = { ...p };
        delete n[key];
        return n;
      });
      if (target === "you") patch([{ op: "add_love", love }]);
      else
        setStateRaw((s) => {
          const cur = s.companion?.loves ?? [];
          if (cur.some((l) => l.query.toLowerCase() === q.toLowerCase())) return s;
          return applyPatches(s, [{ op: "set_companion", loves: [...cur, love] }]);
        });
    },
    [patch],
  );

  const addResolved = useCallback(
    (loves: ResolvedLove[], target: "you" | "them" = "you") => {
      if (target === "you") patch(loves.map((love) => ({ op: "add_love" as const, love })));
      else setStateRaw((s) => applyPatches(s, [{ op: "set_companion", loves: [...(s.companion?.loves ?? []), ...loves] }]));
    },
    [patch],
  );

  const updateLove = useCallback((target: "you" | "them", query: string, fn: (l: ResolvedLove) => ResolvedLove | null) => {
    setStateRaw((s) => {
      const list = target === "you" ? s.loves : s.companion?.loves ?? [];
      const next = list.map((l) => (l.query === query ? fn(l) : l)).filter(Boolean) as ResolvedLove[];
      if (target === "you") return { ...s, loves: next };
      return { ...s, companion: next.length || s.companion ? { loves: next } : null };
    });
  }, []);

  // --- agent
  const askAgent = useCallback(
    async (message: string) => {
      const text = message.trim();
      if (!text || agentBusy) return;
      const uid = Date.now();
      const history = chat.slice(-8).map((t) => ({ role: t.role, content: t.text }));
      setChat((c) => [
        ...c,
        { id: uid, role: "user", text, trace: [] },
        { id: uid + 1, role: "assistant", text: "", trace: [], pending: true },
      ]);
      setAgentBusy(true);
      const upd = (fn: (t: ChatTurn) => ChatTurn) => setChat((c) => c.map((t) => (t.id === uid + 1 ? fn(t) : t)));
      await streamAgent({ state: stateRef.current, message: text, history }, (e: AgentEvent) => {
        if (e.type === "trace") upd((t) => ({ ...t, trace: [...t.trace, { tool: e.tool, summary: e.summary }] }));
        else if (e.type === "patch") patch(e.ops);
        else if (e.type === "delta") upd((t) => ({ ...t, text: t.text + e.text }));
        else if (e.type === "error") upd((t) => ({ ...t, pending: false, error: e.error.message }));
        else if (e.type === "done") upd((t) => ({ ...t, pending: false }));
      });
      upd((t) => ({ ...t, pending: false }));
      setAgentBusy(false);
    },
    [agentBusy, chat, patch],
  );

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
    addResolved,
    updateLove,
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
