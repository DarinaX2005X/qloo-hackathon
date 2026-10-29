import type { FieldCell } from "@/shared/contracts";

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

export function crowdLabel(popularity: number) {
  if (popularity > 0.85) return "busy with visitors";
  if (popularity > 0.55) return "mixed crowd";
  return "mostly locals";
}

/** Floating explanation of one terrain column: how strong, what drives it, who is around. */
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
  return (
    <div
      className="pointer-events-none absolute z-20 w-[232px] rounded-[14px] bg-paper-raised p-3 text-[13px] leading-snug shadow-[var(--shadow-overlay)]"
      style={{ left: Math.min(x + 16, (typeof window !== "undefined" ? window.innerWidth : 1400) - 260), top: Math.max(8, y - 120) }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-[600] text-ink">Taste match</span>
        <span className="tnum text-[20px] font-[650] tracking-[-0.02em] text-you-deep">{Math.round(cell.you * 100)}</span>
      </div>
      {pair && cell.them !== undefined && (
        <div className="mt-0.5 flex items-baseline justify-between text-ink-2">
          <span>Their match</span>
          <span className="tnum font-[600] text-them">{Math.round(cell.them * 100)}</span>
        </div>
      )}
      {drivers.length > 0 && (
        <ul className="mt-2 space-y-1">
          {drivers.map(([d, v]) => (
            <li key={d} className="flex items-center gap-2">
              <span className="h-1.5 rounded-full bg-you" style={{ width: `${Math.max(8, (v / total) * 90)}px` }} />
              <span className="truncate text-ink-2">{loveNames?.[d] ?? DOMAIN_LABEL[d] ?? d}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-ink-3">{crowdLabel(cell.popularity)}</p>
    </div>
  );
}
