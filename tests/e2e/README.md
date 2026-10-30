# Homing: production E2E

Run from the `project` directory, in PowerShell:

```powershell
node tests/e2e/run.mjs
```

The default target is `https://homing-taste.vercel.app`. No local server, package installation, application changes, Playwright Test runner or root config is required. The script uses the Playwright API through `createRequire`, loading the existing dependency at `C:/Users/user/Desktop/qloo/deck/node_modules/playwright`. Its actual version and Chromium version are recorded in the report. The existing Playwright Chromium binary must be available; a missing dependency/browser produces a runner failure report, without installing anything.

Optional environment overrides:

```powershell
$env:BASE_URL = 'https://homing-taste.vercel.app'
$env:PLAYWRIGHT_PATH = 'C:/Users/user/Desktop/qloo/deck/node_modules/playwright'
$env:HEADED = '1' # optional visible browser; default is headless
$env:ONLY = '3,17,10' # optional: run only these scenario ids while debugging
node tests/e2e/run.mjs
```

`ONLY` is for debugging a few scenarios. Most scenarios reuse the resolved taste from scenario 3, so include `3`. With `ONLY` set, the exit code is `0` only if every listed scenario ran and passed. A release check runs without it.

Output:

- `PASS` / `FAIL` and elapsed time for every scenario and subcheck.
- `report/report.md`: scenario table, timings, exact failure messages and screenshot links.
- `report/results.json`: structured subcheck evidence, complete failure stacks, console/page errors and HTTP failures.
- `report/*.png`: representative screenshots and failure evidence.
- Exit code `0` only if all twenty-one scenarios pass; otherwise `1` (also for runner startup failure).

Each run overwrites report files and screenshots with the same names. It does not clean the directory: consult only artifacts linked by the current report. The report directory is already ignored by the project. `report/visual-review.md`, if present, is a manually authored review tied to a specific run timestamp; the runner does not claim to perform that review automatically.

## Coverage

1. Hero recommendation within 20 seconds, then Berlin committed with Enter. New neighborhood names must match the successful Berlin API response and differ from the old recommendation.
2. Hero button navigates to `/explore`, preserving city and tastes in base64url `?s=` state; at least three neighborhood rows appear.
3. Fresh empty Lisbon taste: entering `Radiohead, Fleabag` and Enter creates exactly two resolved URL tastes and visible Music / TV chips.
4. First neighborhood shows at least three places; its first-days plan produces at least six stops.
5. `less touristy`: a new assistant reply has at least 20 characters and Crowd moves above 0.5 within 20 seconds. User echoes and tool traces cannot satisfy the response check. `Find quiet cafes near the water` must add resolved Quiet and Waterfront URL refinements and visible removable chips.
6. Resolve Succession through the companion UI, then open a URL containing `p=[Succession]`. At least three ranking rows and positive-width visible You / Them bars are required.
7. Share shows `Link copied`, writes the actual current URL to the clipboard, and opening it in a new tab restores the ordered neighborhood list and top-1.
8. A separate 390×844 page: hero document/body/section have no horizontal overflow; explore has working Your taste / Neighborhoods tabs. Desktop viewport: 1440×1000.
9. `qwzxv` creates an unresolved chip and its dialog works; existing results/input remain usable. `Lisbonn` must produce new-city results matching its API response or understandable visible feedback. `/nope` must return HTTP 404 with the exact custom heading and a recovery link.
10. Runs last: audit `console.error` and uncaught `pageerror` on every page, including mobile, the restored share tab and scenarios 11–21. Only observed resource 4xx errors matching the exact intentional edge-case requests in scenarios 9 and 11 can be excluded. Unrelated 4xx, all 5xx, JavaScript errors and map errors remain failures. Full errors are retained, including excluded entries.
11. Open a compact `?s=` state for Tokyo, Japan with the same two resolved tastes: at least three neighborhoods and real rendered WebGL pixels. Commit `Qwzxplorvillle` by clicking away, require visible "We couldn't find" feedback and removal of previous neighborhood rows/map markers, then return to Lisbon and require neighborhoods/map again. The unknown-city screenshot also supports pixel review for cleared terrain; the basemap may remain.
12. On the landing page type `Reykjav`, observe the real Photon lookup without selecting a result or pressing Enter, then click the hero `Map my taste` even if the lookup fails. Explore URL state must start with `Reykjavik` and retain resolved tastes; failures include lookup status/body and the resulting URL city.
13. Add `jazz` in explore: a resolved artist must appear in URL state and a visible chip must say `Music, for jazz`.
14. Add the Cozy must-have and set Budget `$$`, checking resolved URL state and selected control. Open the first neighborhood and plan, change Pace to Packed (stop count cannot decrease), swap the first stop (its name changes and the old name disappears), open a place drawer and Save, return to ranking and find the same place in Saved with `Plan around these N`.
15. Compare cities dialog lists Lisbon and Berlin; replace the third default with Tokyo through its city combobox. Compare must render at least two successful result cards, with the first indexed at 100. `Open the map of …` must switch to a different city, close the dialog and render neighborhoods/WebGL pixels.
16. Open a neighborhood from ranking, then use the actual browser Back action. The ranking and same ordered neighborhoods must return, URL pathname must remain `/explore`, and selected-neighborhood URL state must be cleared.
17. Screens and rail. Start from the Lisbon taste URL on Map and tag the MapLibre canvas with a JS property. Then use the rail to open Assistant, Home (Feels like home), Address (Check an address), Why (What decides), Trip, Compare and Map again. On each screen:
    - the pathname must match;
    - the screen's own panel must be visible;
    - the rail item must have `aria-current="page"`;
    - `?s=` must decode to the same city and taste ids;
    - exactly one map canvas must exist, and it must still carry the tag, so the map was not remounted.

    Browser Back then returns to Compare, then to Trip, with the same checks. A separate 390×844 page must show the bottom tab bar docked at the bottom, with Map, Assistant, Home, Address and More, and no desktop rail. More must open a sheet that leads to What decides, Trip and Compare. After each one, the More tab shows that screen's short name, `?s=` is kept, and there is no horizontal overflow.
18. Feels like home on `/explore/home`:
    - choose Berlin in the panel's own city picker (by option; see the note below), type Kreuzberg and run;
    - the `/api/home` request must carry Berlin / Kreuzberg;
    - at least one rendered match needs a "N% alike" similarity and a twin pair ("at home" place → place here) or "Shares" tags;
    - the map legend must read "The terrain shows Kreuzberg, Berlin printed over Lisbon".
19. Check an address on `/explore/address`:
    - `Rua da Rosa 120` must give "Better than N%" with 0 < N ≤ 100, a neighborhood name ("In X, ranked #N for you") and at least one walk place with minutes;
    - after the camera settles, click a bare map point about 180 px from the pin, not a neighborhood plate. That must send a `point`-only `/api/spot`, and the new result label must differ from the previous one and must not be raw coordinates.
20. What decides on `/explore/why`: the summary from the `/api/decides` response must be visible. For the first neighborhood there must be exactly one row per active love, naming that love and showing `#N` (Falls to / Rises to / Stays) or "Out of the top 8".
21. Assistant on `/explore/assistant`:
    - `I used to live in Kreuzberg, Berlin` must get a `text/event-stream` `/api/agent` response, a reply of at least 20 characters and a compact home card ("Kreuzberg, Berlin in …" with a percentage);
    - "Open on the map" must land on `/explore/home` with the matches, the Kreuzberg legend and the neighborhood filled in;
    - no `/api/home` request may be issued for 3 seconds after the click, judged by watching page network requests.

The run uses one fresh browser context, real production services, and no mocked responses, injected application state or retries of failed scenarios. General interaction timeouts are 20 seconds; neighborhood loads, map readiness and new feature service waits allow up to 45 seconds for Qloo/Photon latency (60 seconds for cold `/api/home` and `/api/decides`, 120 seconds for a full assistant answer). The original 20-second Hero budget includes navigation; the `less touristy` agent budget starts at submitting the prompt. Map readiness samples real WebGL pixels instead of accepting an empty canvas. Timing for a scenario includes all its steps and screenshot capture, so combined scenarios can exceed a single timeout.

Failed subchecks do not stop independent later checks. Scenarios 4–9 and 11–21 reuse real resolved URL entities captured in scenario 3; missing prerequisite state produces an explicit dependency failure, never a silent skip or manufactured PASS. Scenario 9 observes the field response first because an unrecognized city can fail before a neighborhood request is made. Visual screenshots support a separate pixel review; they do not establish human comprehension or user approval. No application fixes are made.

The city picker has a known quirk that scenario 18 avoids on purpose: when its value is already Berlin, typing `Berlin` and pressing Enter commits the first popular city (Lisbon). So the test clicks the Berlin option instead. See `tasks/07-e2e.out.md`.
