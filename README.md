<p align="center">
  <img src="docs/logo-badge.svg" width="96" alt="Homing logo" />
</p>

<h1 align="center">Homing</h1>

<p align="center"><strong>Find a neighborhood that feels like you in a new city.</strong><br/>
You are moving and you don't know the city yet. Bring the things you love, or the neighborhood you loved living in. Homing suggests three areas to start your home search, shows why, and gives you real places to check in each.</p>

<p align="center">
  <a href="https://homing-taste.vercel.app"><strong>Try it live</strong></a> &nbsp;&nbsp;
  <a href="https://homing-taste.vercel.app/#demo">Watch the film</a> &nbsp;&nbsp;
  <a href="#one-run-start-to-finish">One run, start to finish</a> &nbsp;&nbsp;
  <a href="#where-qloo-comes-in">Where Qloo comes in</a> &nbsp;&nbsp;
  <a href="#run-it-locally">Run it locally</a>
</p>

![The Lisbon shortlist for Radiohead, Fleabag, Wes Anderson and Patagonia](docs/shortlist.jpg)

## Who it is for

Someone moving to a new city for months or longer, alone or with a partner, who has to decide where to look at flats before they know the place. Rental sites show flats and prices. They don't show whether the streets around a flat will feel like your kind of place. Homing answers that part: **where to start looking, and what to check when you get there.**

It does not judge the flat, the rent, safety, schools or transport. It says so in the product.

**Try your own input:** open [homing-taste.vercel.app](https://homing-taste.vercel.app), type a few things you love (artists, shows, films, books, brands, places) or switch to *Where I lived* and name your old neighborhood, pick the city you are moving to, and press *Find my areas*.

## One run, start to finish

All numbers below come from one live run of the released code with live Qloo data (Lisbon, with Radiohead, Fleabag, Wes Anderson and Patagonia), captured <!--RUN_DATE-->30 October 2026<!--/RUN_DATE-->.

**1. A shortlist of three.** Homing checks the same 24 areas of Lisbon for everyone: walkable circles of about 650 m around fixed centres. For this taste it starts with <!--SHORTLIST-->Graça, Saldanha and Anjos<!--/SHORTLIST-->. Each card says the rank (*#1 of 24 areas checked*), the love Qloo ties most to the area's places, two real places to visit, and one thing to check, like a place with no listed hours.

**2. Why this area.** The proof sits next to the answer. <!--WHY-->Qloo's own explanation says Radiohead carries about 28% of its reason for picking Rooftop - Topo Martim Moniz in Graça. Homing ranks all 24 areas again without each love: without Wes Anderson, Graça moves from #1 to #2; without Radiohead, Fleabag or Patagonia it stays #1.<!--/WHY--> A move inside the tie band is reported as stable, never as a change.

![Why this area: a love linked to a real place, and the ranking without each love](docs/why.jpg)

**3. Feels like home.** Name the neighborhood you lived in. Homing reads the places that define it in Qloo, turns their style tags into a signature, and compares it with every area of the new city on one fixed reference. <!--HOME-->Starting from Alfama, Lisbon, it puts Alfama first at *Style overlap 100/100*, then Sé at 38 and Graça at 29. Starting from Kreuzberg, Berlin, the closest Lisbon area scores 25/100, and Homing says this is a weak match and offers to mix in what you love.<!--/HOME--> Picking an area shows a place from the old neighborhood, the style they share, and a place to try here.

| Alfama finds Alfama | Kreuzberg in Lisbon, with a place-to-place link |
| --- | --- |
| ![](docs/home-alfama.jpg) | ![](docs/home-kreuzberg.jpg) |

**4. Check an address.** <!--ADDRESS-->*Rua da Rosa 120* matches the street, not the house number, and the answer says so. It sits in Encarnação. Homing lists the places within a short walk, with walking minutes and which of them have no listed hours.<!--/ADDRESS-->

**5. Try the neighborhood.** A short walk of three or four places in the area you picked, at the time of day you pick. <!--VISIT-->With *No bars* on, the walk in Graça is three stops from 14:00.<!--/VISIT--> The rule is kept for every re-plan, swap and assistant answer. Swapping one stop keeps the others.

| Check an address | Try the neighborhood |
| --- | --- |
| ![](docs/address.jpg) | ![](docs/visit.jpg) |

**6. Ask the assistant.** <!--AGENT-->"Check Rua da Rosa 120 for me. Then plan a relaxed afternoon nearby, no museums, no bars, and only places within $$ where you know the price." The assistant splits this into two goals, checks the address, builds the walk, and audits it against the rules. When a role can't be filled inside the rules, it searches again in a different way and, if that still fails, leaves the gap visible with the reason. Both goals end as *partial*: the house number is unverified, and no culture stop fits the rules.<!--/AGENT-->

<p align="center"><img src="docs/agent.jpg" width="820" alt="The assistant with its goal list and the re-plan it made" /></p>

**7. A different person, a different city.** <!--BERLIN-->Ben Klock, Kantine am Berghain and Rick Owens in Berlin start with Friedrichshain. Asked for dark techno with no hotel bars and no adult clubs, the assistant returns only venues Qloo classifies as night clubs, such as Crack Bellmer, Bricks and Tresor, and tells you to check event schedules.<!--/BERLIN-->

<p align="center"><img src="docs/mobile-shortlist.jpg" width="250" alt="The shortlist on a phone" />&nbsp;&nbsp;<img src="docs/mobile-home.jpg" width="250" alt="Feels like home on a phone" />&nbsp;&nbsp;<img src="docs/mobile-visit.jpg" width="250" alt="The walk on a phone" /></p>

## Where Qloo comes in

Qloo is the only source of taste and place data. The chain for one shortlist:

1. **Your loves become Qloo entities.** `GET /search` resolves "Fleabag" to the show. A name with several strong matches asks which one you mean; a name that matches nothing says so, and nothing is guessed.
2. **The city becomes fixed areas, before any taste is read.** Place insights with no taste signal (coffee, food, nightlife, culture) inside 7.5 km of the centre locate the areas: circles of about 650 m around the places' medians. Lisbon has 24, Berlin 19. Your taste never moves, adds or renames an area, so ranks stay comparable between people.
3. **Each love is read across those areas.** One `urn:heatmap` insight per love around the city centre. Each love's cells are ranked inside the city and averaged over the cells that belong to each area, weighted by how much you care about that love. The result is an order, shown as *#N of 24 areas checked*.
4. **Places are checked before taste.** Place insights inside each circle, signalled by your loves with `feature.explainability`. Every place first passes an eligibility gate: a café must be a café, a dance venue must be classified as a night club, adult venues, hotels and shops are rejected, and hard rules like *No bars* or a budget apply. Then Qloo's explainability says which love it credits for each place.
5. **Why this area** reuses the per-love heatmaps to rank the 24 areas again without each love.
6. **Feels like home** asks for places within 650 m of the old neighborhood, keeps their distinctive ambience and decor tags, and compares that signature with each area on one fixed Berlin/Lisbon/Reykjavík reference. A place-to-place link appears only when Qloo's explainability connects a place in the old neighborhood to one in the new area.

Without Qloo there is no ranking, no place, no link and no Feels like home to show.

## What the numbers mean

- **#1 of 24 areas checked** is a rank among the fixed areas of that city. It is not a percentile or a probability. When the next area is within the tie band, the card says *About level with the next area*.
- **Style overlap 38/100** in Feels like home is an index of how much two places' style signatures share. It is not a percentage of people, and 100 means the same signature.
- **"Radiohead carries about 28% of Qloo's reason"** is Qloo's own explainability for that one place. It is not a share of people.
- **"2 of 3 places are tagged Contemporary, compared with 29 of 324 in the city sample"** counts provider-tagged places, not residents.
- Nothing in Homing says "% alike", "Match 87" or "better than N% of the city".

## What is known and what is not

- Areas are approximate circles, not official neighborhood boundaries.
- The ranking is a starting list for exploring. Every area is marked as needing a check on the ground.
- A typed address often matches only the street. Then the house number is not verified, and the answer says so.
- Many places have no listed opening hours or price in Qloo. Homing shows them as unknown. A walk with a budget only uses places with a known price within it.
- Event schedules are not verified. Dance venues come with a note to check the venue's listings.
- Feels like home between two different cities is often weak. When two cities score less than 10 points apart, Homing names no winner.
- The assistant's first answer on a cold server can take 10–20 seconds; warm answers take 2–4 seconds in my measurements. These are small samples, not guarantees.

## The assistant

`POST /api/agent` streams Server-Sent Events. The model (Gemini 3.8 Flash through OpenRouter) turns a request into typed goals such as *choose an area*, *check an address*, *build a visit*, *find venues* or *compare cities*, plus hard and soft rules. Tools call the same engine as the screens. After each tool the result is checked: an address goal is partial when only the street matched, a visit is audited against every rule, a weak Feels like home match triggers the blend the person asked for. The stream carries `plan`, `step`, `observation`, `replan`, `result`, `answer` and `done`, so the UI shows the goal list, the live steps and every change of approach.

Limits keep it honest: a 40 second turn deadline, at most 8 tool decisions and 2 recovery decisions per turn, and four extra role searches for a visit. Every goal ends with a result or a reason it is unfinished. Rules like *No bars* are kept in session memory and survive unrelated turns. A comparison of cities never changes the city on the map.

## Architecture

One Next.js app. The browser holds the state (in the URL, so a link reproduces the result) and draws the map; route handlers on Vercel run the engine and the assistant.

```
 Browser                                   Vercel route handlers                          External
 Landing ── GET /api/landing?part=hero ──► example shortlist, cached                 ┐
 /explore (one map, screens around it)                                                │
   ├─ POST /api/field, /api/neighborhoods ► engine/09: fixed areas, per-love ranking  │
   ├─ POST /api/decides ─────────────────► ranking without each love                 ├─► Qloo Taste AI
   ├─ POST /api/home, /api/cities ───────► style signatures, one fixed reference     │   /search, /v2/insights, /v2/tags
   ├─ POST /api/spot ────────────────────► address point, its area, nearby places    │
   ├─ POST /api/plan ────────────────────► constrained walk, swaps, audit            │
   ├─ POST /api/places ──────────────────► eligible places with explainability       ┘
   ├─ GET  /api/localities ──────────────► Photon + Open-Meteo geocoding
   └─ POST /api/agent (SSE) ─────────────► agent/09: goals, tools, audit, replan ────► OpenRouter (Gemini 3.8 Flash)
 MapLibre GL ◄── vector tiles ─────────────────────────────────────────────────────── OpenFreeMap
```

| Path | What lives there |
| --- | --- |
| `src/shared/contracts-09.ts` | Zod schemas for every v2 request and response: areas, metrics, venue evidence, Home, address, visit, agent events. |
| `src/server/engine/09/` | Fixed manifest of areas, per-love ranking, area cards, venue eligibility, Home signatures, address check, visit planner. |
| `src/server/agent/09/` | Planning, tools, rule extraction, audit, session memory, the SSE runner. |
| `src/server/qloo/` | The one Qloo client: cache, concurrency limit, retries, response trimming. |
| `src/components/` | The map (MapLibre hex terrain), the shell, the shortlist, Feels like home, Address, Why this area, the walk and the assistant. |
| `tests/` | Vitest unit and route tests, live Qloo suites behind a flag, HTTP and browser checks for the five assistant dialogues. |

## Run it locally

```bash
git clone https://github.com/DarinaX2005X/qloo-hackathon.git
cd qloo-hackathon
npm install
cp .env.example .env.local   # add your keys
npm run dev
```

| Variable | What it is |
| --- | --- |
| `QLOO_API_KEY` | Qloo Taste AI key (hackathon server) |
| `QLOO_API_URL` | `https://hackathon.api.qloo.com` |
| `OPENROUTER_API_KEY` | OpenRouter key for the assistant |
| `LLM_MODEL` | `google/gemini-3.8-flash` |

## Tests

- `npm test` runs the offline suite: <!--TESTS-->409 passed, 25 skipped<!--/TESTS--> (the skipped ones are live Qloo suites, run with `QLOO_LIVE=1`).
- `npx tsx tests/agent/http-09.mts 1,2,3,4,5 --follow` runs the five assistant dialogues with follow-ups against a running server. In my last runs all 30 turns ended with every goal settled and no hard rule broken.
- `node tests/e2e/09/qa-ui.mjs` takes browser screenshots of the main journey at 1440×900 and 390×844.

Qloo responses are cached on the server and never stored in this repository. Keys live in `.env.local` and in the Vercel project settings.

## License

[MIT](LICENSE)
