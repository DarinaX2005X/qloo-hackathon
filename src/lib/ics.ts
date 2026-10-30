import type { Itinerary } from "@/shared/contracts";

const pad = (n: number) => String(n).padStart(2, "0");
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};

/** Floating local time (no TZ): the plan lands at the same clock time in the city. `minutes` may run
 *  past midnight (24:30 is 00:30 the next day), and the date rolls over with it. */
function stamp(date: Date, minutes: number) {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate() + Math.floor(minutes / 1440));
  const t = ((minutes % 1440) + 1440) % 1440;
  return `${day.getFullYear()}${pad(day.getMonth() + 1)}${pad(day.getDate())}T${pad(Math.floor(t / 60))}${pad(t % 60)}00`;
}

const utcStamp = (d: Date) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

/** Start and end of each stop in minutes from the day's midnight. A day that runs late keeps counting
 *  past 24:00, so a stop after midnight (or one that ends after it) is placed on the next date. */
export function stopTimes(times: string[]): { start: number; end: number }[] {
  const starts: number[] = [];
  for (const t of times) {
    let m = toMin(t);
    const prev = starts[starts.length - 1];
    while (prev !== undefined && m < prev) m += 1440;
    starts.push(m);
  }
  return starts.map((start, i) => {
    const next = starts[i + 1];
    let end = next !== undefined ? next - 10 : start + 90;
    if (end <= start) end = start + 60;
    return { start, end };
  });
}

export function itineraryToIcs(plan: Itinerary, city: string, now = new Date()): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Homing//Taste plan//EN", "CALSCALE:GREGORIAN"];
  plan.days.forEach((day, di) => {
    const date = day.date ? new Date(`${day.date}T00:00:00`) : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1 + di);
    const times = stopTimes(day.stops.map((s) => s.time));
    day.stops.forEach((s, si) => {
      const { start, end } = times[si];
      // the file carries no time zone, so the description says which clock the times are on
      const clock = `${s.time} local time in ${city}${s.walkMin ? `, about ${s.walkMin} min walk` : ""}`;
      lines.push(
        "BEGIN:VEVENT",
        `UID:homing-${di}-${si}-${s.place.id}@homing`,
        `DTSTAMP:${utcStamp(now)}`,
        `DTSTART:${stamp(date, start)}`,
        `DTEND:${stamp(date, end)}`,
        `SUMMARY:${esc(`${s.slot}: ${s.place.name}`)}`,
        `LOCATION:${esc(s.place.address ?? `${s.place.name}, ${city}`)}`,
        `DESCRIPTION:${esc([clock, ...s.place.why.slice(0, 3), s.place.mapsUrl].filter(Boolean).join("\n"))}`,
        "END:VEVENT",
      );
    });
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export function itineraryToText(plan: Itinerary, city: string): string {
  return [
    `My first days in ${city}, planned with Homing`,
    ...plan.days.flatMap((d, i) => [
      "",
      `Day ${i + 1}${d.weekday ? `, ${d.weekday[0].toUpperCase()}${d.weekday.slice(1)}` : ""}: ${d.neighborhood}`,
      ...d.stops.map((s) => `${s.time}  ${s.place.name} (${s.slot.toLowerCase()})${s.walkMin ? `, ${s.walkMin} min walk` : ""}`),
    ]),
  ].join("\n");
}

export function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
