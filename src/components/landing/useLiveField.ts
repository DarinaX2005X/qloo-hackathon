"use client";

import { useEffect, useRef, useState } from "react";
import type { ExploreState, Neighborhood, ResolvedLove, TasteField } from "@/shared/contracts";
import { pickEntity } from "@/lib/pick";
import { api } from "@/components/explore/api";
import { emptyState } from "@/lib/state";

/** Resolve a short list of names to Qloo entities, in order, skipping misses. */
export async function resolveNames(names: string[]): Promise<ResolvedLove[]> {
  const out = await Promise.all(
    names.map(async (q) => {
      try {
        const r = await api.search(q);
        return { query: q, chosen: pickEntity(q, r), candidates: r, weight: 1 } as ResolvedLove;
      } catch {
        return { query: q, chosen: null, candidates: [], weight: 1 } as ResolvedLove;
      }
    }),
  );
  return out;
}

/** Field and neighborhoods for a small landing scene. Keeps the last good result while a new one loads. */
export function useLiveField(city: string, loves: ResolvedLove[], companion?: ResolvedLove[] | null, withHoods = true) {
  const [field, setField] = useState<TasteField | null>(null);
  const [hoods, setHoods] = useState<Neighborhood[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify([city, loves.map((l) => l.chosen?.id), companion?.map((l) => l.chosen?.id)]);
  const last = useRef("");

  useEffect(() => {
    if (!loves.some((l) => l.chosen) || key === last.current) return;
    const ac = new AbortController();
    const state: ExploreState = { ...emptyState(city), loves, companion: companion?.length ? { loves: companion } : null };
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const f = await api.field(state, ac.signal);
        setField(f);
        last.current = key;
        if (withHoods) setHoods(await api.neighborhoods(state, ac.signal));
      } catch (e) {
        if ((e as Error).message !== "aborted") setError((e as Error).message);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    }, 450);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { field, hoods, loading, error };
}
