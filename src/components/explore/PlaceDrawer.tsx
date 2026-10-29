"use client";

import { motion } from "motion/react";
import { ArrowLeft, Bookmark, BookmarkCheck, CalendarPlus, ExternalLink, Globe, MapPin } from "lucide-react";
import type { Category, Place } from "@/shared/contracts";
import { useExplore } from "./store";
import { Button } from "@/components/ui/primitives";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const CAT: Record<Category, string> = { coffee: "Coffee", food: "Food", drinks: "Drinks", culture: "Culture", stay: "Stay" };
const PRICE = ["", "$", "$$", "$$$", "$$$$"];
const hhmm = (s: string) => s.replace(/^T/, "").slice(0, 5);

/** Everything about one place, and what you can do with it. */
export function PlaceDrawer({ place }: { place: Place }) {
  const ex = useExplore();
  const saved = ex.isSaved(place.id);
  const inPlan = !!ex.plan.data?.days.some((d) => d.stops.some((s) => s.place.id === place.id));
  const today = DAYS[(new Date().getDay() + 6) % 7];
  return (
    <motion.div
      key={place.id}
      initial={{ opacity: 0, x: 28 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 28 }}
      transition={{ duration: 0.26, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <button onClick={() => ex.setOpenPlace(null)} className="mb-3 flex items-center gap-1 text-[13px] font-[550] text-ink-2 hover:text-ink">
        <ArrowLeft size={15} /> Back
      </button>
      {place.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={place.image} alt="" className="mb-4 h-[190px] w-full rounded-[18px] object-cover shadow-[var(--shadow-rest)]" />
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[26px] font-[680] leading-tight tracking-[-0.025em]">{place.name}</h3>
          <p className="mt-1 text-[13.5px] text-ink-2">
            {CAT[place.category]}
            {place.priceLevel ? `, ${PRICE[place.priceLevel]}` : ""}
            {place.neighborhood ? ` in ${place.neighborhood}` : ""}
          </p>
        </div>
        <span className="tnum shrink-0 rounded-[10px] bg-you-soft px-2.5 py-1 text-[17px] font-[680] text-you-deep" title="How strongly people with your taste rate it">
          {Math.round(place.affinity * 100)}
        </span>
      </div>

      {place.why.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {place.why.map((w) => (
            <span key={w} className="rounded-[7px] bg-you-soft px-2 py-1 text-[12.5px] font-[520] text-you-deep">
              {w}
            </span>
          ))}
        </div>
      )}
      {place.description && <p className="mt-3 text-[14.5px] leading-relaxed text-ink-2">{place.description}</p>}
      {place.keywords && place.keywords.length > 0 && (
        <p className="mt-2 text-[13px] text-ink-3">People mention: {place.keywords.join(", ")}</p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant={inPlan ? "secondary" : "primary"} size="md" disabled={inPlan || ex.plan.loading} onClick={() => void ex.addToPlan(place)}>
          <CalendarPlus size={16} /> {inPlan ? "In your plan" : "Add to plan"}
        </Button>
        <Button variant="secondary" size="md" onClick={() => ex.toggleSave(place)} aria-pressed={saved}>
          {saved ? <BookmarkCheck size={16} className="text-you" /> : <Bookmark size={16} />} {saved ? "Saved" : "Save"}
        </Button>
      </div>

      {place.hours && Object.keys(place.hours).length > 0 && (
        <div className="mt-5">
          <h4 className="mb-1.5 text-[13px] font-[600] text-ink-2">Opening hours</h4>
          <ul className="space-y-0.5 text-[13.5px]">
            {DAYS.map((d) => {
              const spans = place.hours?.[d];
              return (
                <li key={d} className={`flex justify-between rounded-[7px] px-2 py-1 ${d === today ? "bg-paper-sunk font-[580] text-ink" : "text-ink-2"}`}>
                  <span className="capitalize">{d}</span>
                  <span className="tnum">{!spans ? "not listed" : spans.length ? spans.map((s) => `${hhmm(s.opens)}–${hhmm(s.closes)}`).join(", ") : "closed"}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="mt-5 space-y-2 text-[14px]">
        {place.address && (
          <p className="flex items-start gap-2 text-ink-2">
            <MapPin size={15} className="mt-0.5 shrink-0 text-ink-3" /> {place.address}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <a href={place.mapsUrl} target="_blank" rel="noreferrer" className="flex h-9 items-center gap-1.5 rounded-[10px] bg-paper-sunk px-3 font-[550] text-ink hover:bg-line">
            <ExternalLink size={14} /> Open in Maps
          </a>
          {place.website && (
            <a href={place.website} target="_blank" rel="noreferrer" className="flex h-9 items-center gap-1.5 rounded-[10px] bg-paper-sunk px-3 font-[550] text-ink hover:bg-line">
              <Globe size={14} /> Website
            </a>
          )}
        </div>
      </div>
    </motion.div>
  );
}
