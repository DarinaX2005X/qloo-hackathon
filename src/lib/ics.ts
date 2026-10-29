import type { Itinerary } from "@/shared/contracts";

const pad = (n: number) => String(n).padStart(2, "0");
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

/** Floating local times (no TZ), so the plan lands at the same clock time in the city. */
function stamp(date: Date, hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(h)}${pad(m)}00`;
}

export function itineraryToIcs(plan: Itinerary, city: string): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Homing//Taste plan//EN", "CALSCALE:GREGORIAN"];
  const today = new Date();
  plan.days.forEach((day, di) => {
    const date = day.date ? new Date(`${day.date}T00:00:00`) : new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1 + di);
    day.stops.forEach((s, si) => {
      const next = day.stops[si + 1]?.time;
      const [h, m] = s.time.split(":").map(Number);
      const endMin = next ? Number(next.split(":")[0]) * 60 + Number(next.split(":")[1]) - 10 : h * 60 + m + 90;
      const end = `${pad(Math.floor(endMin / 60) % 24)}:${pad(endMin % 60)}`;
      lines.push(
        "BEGIN:VEVENT",
        `UID:homing-${di}-${si}-${s.place.id}@homing`,
        `DTSTAMP:${stamp(today, "00:00")}`,
        `DTSTART:${stamp(date, s.time)}`,
        `DTEND:${stamp(date, end)}`,
        `SUMMARY:${esc(`${s.slot}: ${s.place.name}`)}`,
        `LOCATION:${esc(s.place.address ?? `${s.place.name}, ${city}`)}`,
        `DESCRIPTION:${esc([...s.place.why.slice(0, 3), s.place.mapsUrl].join("\n"))}`,
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
