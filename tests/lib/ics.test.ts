import { describe, expect, it } from "vitest";
import type { Itinerary, Place } from "@/shared/contracts";
import { itineraryToIcs, stopTimes } from "@/lib/ics";

const place = (id: string, name: string): Place => ({
  id, name, category: "drinks", lat: 45.5, lon: -73.57, affinity: 0.8, popularity: 0.5, why: ["Cocktails"], mapsUrl: `https://maps.example/${id}`,
});

const plan = (date: string, times: string[]): Itinerary => ({
  days: [{ date, neighborhood: "Ville-Marie", missing: [], stops: times.map((time, i) => ({ time, slot: `Stop ${i + 1}`, place: place(`p${i}`, `Place ${i}`), walkMin: 5 })) }],
});

const events = (ics: string) =>
  ics.split("\r\n").reduce<Record<string, string>[]>((all, line) => {
    if (line === "BEGIN:VEVENT") all.push({});
    const [key, ...rest] = line.split(":");
    if (all.length && line !== "BEGIN:VEVENT") all[all.length - 1][key] = rest.join(":");
    return all;
  }, []);

describe("calendar export", () => {
  it("rolls the end over to the next date when the last stop runs past midnight", () => {
    const [last] = events(itineraryToIcs(plan("2026-11-01", ["22:30"]), "Montreal")).slice(-1);
    expect(last.DTSTART).toBe("20261101T223000");
    expect(last.DTEND).toBe("20261102T000000");
  });

  it("places a stop after midnight on the next date, also across a month end", () => {
    const ev = events(itineraryToIcs(plan("2026-11-30", ["21:00", "23:30", "00:30"]), "Montreal"));
    expect(ev.map((e) => e.DTSTART)).toEqual(["20261130T210000", "20261130T233000", "20261201T003000"]);
    expect(ev[1].DTEND).toBe("20261201T002000");
    expect(ev[2].DTEND).toBe("20261201T020000");
  });

  it("never ends an event before it starts", () => {
    for (const times of [["09:00", "09:05"], ["23:50"], ["20:00", "22:30", "23:55", "01:00"]]) {
      for (const { start, end } of stopTimes(times)) expect(end).toBeGreaterThan(start);
    }
    for (const e of events(itineraryToIcs(plan("2026-12-31", ["22:00", "23:59"]), "Lisbon"))) expect(e.DTEND > e.DTSTART).toBe(true);
  });

  it("says in the description that floating times are the city's local time", () => {
    const [ev] = events(itineraryToIcs(plan("2026-11-01", ["10:30"]), "Montreal"));
    expect(ev.DESCRIPTION.startsWith("10:30 local time in Montreal")).toBe(true);
    expect(ev.DTSTART.endsWith("Z")).toBe(false);
    expect(ev.DTSTAMP).toMatch(/^\d{8}T\d{6}Z$/);
  });
});
