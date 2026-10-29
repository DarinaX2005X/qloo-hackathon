"use client";

import { useEffect, useState } from "react";
import { TerrainMap } from "@/components/map/TerrainMap";
import type { TasteField } from "@/shared/contracts";

export default function Lab() {
  const [city, setCity] = useState("lisbon");
  const [pair, setPair] = useState(false);
  const [field, setField] = useState<TasteField | null>(null);
  useEffect(() => {
    fetch(`/_lab/${city}.json`).then((r) => r.json()).then(setField);
  }, [city]);
  return (
    <main className="h-dvh w-full">
      <TerrainMap field={field} mode={pair ? "pair" : "you"} />
      <div className="absolute left-4 top-4 flex gap-2">
        <button className="rounded-xl bg-paper-raised px-3 py-2 shadow-[var(--shadow-raised)]" onClick={() => setCity(city === "lisbon" ? "berlin" : "lisbon")}>{city}</button>
        <button className="rounded-xl bg-paper-raised px-3 py-2 shadow-[var(--shadow-raised)]" onClick={() => setPair(!pair)}>{pair ? "pair" : "you"}</button>
      </div>
    </main>
  );
}
