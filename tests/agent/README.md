# Agent checks

Run `npx vitest run tests/agent` for deterministic transport, intake, tool-loop and route checks. Tests mock the model and engine; ordinary runs never call external services.

For live integration checks, set `QLOO_LIVE=1` and run `npx vitest run tests/agent/integration.live.test.ts --reporter=verbose`. Each of the four requests starts independently from Lisbon + Radiohead and goes through the real POST route. The suite loads `.env.local` without printing credentials. Full events, rankings and a compact report are saved only under ignored `tests/agent/__fixtures__/integration-1.json` through `integration-4.json`.

`tests/agent/live.test.ts` also covers text intake, a simple image and the engine connection. Its image check runs when `tests/agent/__fixtures__/visible-books.png` exists and expects only the visible titles DUNE and THE HOBBIT. It does not measure recognition accuracy on real crowded bookshelves.

Integration findings reported by the user: a private entity-validation error leaked into trace, and successful patches ended with a generic step-limit reply. Regression checks now cover both cases.

The model gets eight tool decisions / eight turns, with 40 seconds for that loop. Required server refreshes of get_ranking run after changes to ranking inputs and do not consume the model's decision budget. The final response receives only confirmed changes and the current top neighborhood, without tools; it has a separate 15-second deadline. This keeps the total below the route's 60-second limit. If final generation fails, a deterministic reply names the actual changes and available top. With no applied changes at the limit/timeout, the reply honestly asks for a rephrasing.

Tool errors are returned privately to the model and never emitted as trace. Successful traces describe actions in English. New place refinements are capped at two across the entire request, including separate patch calls. Days-only changes keep an existing ranking; changes affecting neighborhood choice rebuild it. An unresolved genre like techno can be recorded with chosen:null; it is not claimed as a ranking signal. Entity metadata remains authoritative from search, including canonical UUID casing.

All four requested integrated live scenarios passed on 2026-10-29. See the ignored fixtures or the chat report for their exact trace, patches and final text. Tests separately cover limit and timeout finalization, a stalled final response, cancellation, stale ranking, private errors, and the refinement cap.
