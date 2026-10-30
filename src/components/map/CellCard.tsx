import type { FieldCell } from "@/shared/contracts";
import { SUPPORT_FLOOR, supportOf } from "./hexgrid";

const DOMAIN_LABEL: Record<string, string> = {
  artist: "music",
  movie: "film",
  tv_show: "TV",
  book: "books",
  author: "books",
  person: "film people",
  brand: "brands",
  place: "places",
  podcast: "podcasts",
  video_game: "games",
  destination: "travel",
};

/** Words for a cell's place on this map. The value is a rank among the map's own cells, so it is said as a band, not a number. */
function band(v: number) {
  if (v >= 0.85) return "Among the strongest on this map";
  if (v >= 0.65) return "Stronger than most of this map";
  if (v >= 0.4) return "About average for this map";
  return "Weaker than most of this map";
}

/** Floating note for one terrain column: how strong the cultural signal is here, what carries it, how much data there is. */
export function CellCard({
  x,
  y,
  cell,
  loveNames,
  pair,
}: {
  x: number;
  y: number;
  cell: FieldCell;
  loveNames?: Partial<Record<string, string>>;
  pair?: boolean;
}) {
  const drivers = Object.entries(cell.drivers)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  const total = drivers.reduce((s, [, v]) => s + v, 0) || 1;
  const limited = supportOf(cell) < SUPPORT_FLOOR;
  return (
    <div
      className="pointer-events-none absolute z-20 w-[240px] rounded-[14px] bg-paper-raised p-3 text-[13px] leading-snug shadow-[var(--shadow-overlay)]"
      style={{ left: Math.min(x + 16, (typeof window !== "undefined" ? window.innerWidth : 1400) - 260), top: Math.max(8, y - 120) }}
    >
      <p className="text-[12px] font-[560] text-ink-3">{pair ? "Your cultural signal here" : "Cultural signal here"}</p>
      <p className="mt-0.5 font-[620] text-ink">{limited ? "Limited data here" : band(cell.you)}</p>
      {pair && cell.them !== undefined && !limited && (
        <p className="mt-1 text-ink-2">
          <span className="font-[560] text-them">Theirs:</span> {band(cell.them).toLowerCase()}
        </p>
      )}
      {drivers.length > 0 && !limited && (
        <ul className="mt-2 space-y-1">
          {drivers.map(([d, v]) => (
            <li key={d} className="flex items-center gap-2">
              <span className="h-1.5 rounded-full bg-you" style={{ width: `${Math.max(8, (v / total) * 90)}px` }} />
              <span className="truncate text-ink-2">{loveNames?.[d] ?? DOMAIN_LABEL[d] ?? d}</span>
            </li>
          ))}
        </ul>
      )}
      {limited && <p className="mt-1 text-ink-2">Too few of your loves have data around this spot to say how it compares.</p>}
    </div>
  );
}
