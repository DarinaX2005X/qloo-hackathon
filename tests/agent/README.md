# Agent checks

Run `npx vitest run tests/agent` for deterministic transport, planning, intake, tool-loop and SSE checks. Ordinary runs mock external services.

Live benchmark: set `QLOO_LIVE=1`, then run `npx vitest run tests/agent/integration.live.test.ts --reporter=verbose`. Five independent requests start from Lisbon + Radiohead + Fleabag. The last request repeats the partner case with warm Qloo caches. The harness consumes SSE incrementally and records first trace, first actual tool action, first final delta, done, model-call count, ranking time, patches and exact text. It does not prewarm new profiles. Full responses and timing reports are written only to ignored `tests/agent/__fixtures__/speed-1.json` through `speed-5.json`.

User findings retained: private validation errors leaked into trace; confirmed changes ended with a limit message; the partner request took about 30 seconds with four model calls. Regression tests cover private errors, finalization and the reduced call count.

The common edit path uses one short JSON plan, without entity ids invented by the model. All independent search_entities/search_place_tags run with Promise.all. Server code builds validated StatePatch operations from authoritative lookup results, executes apply_changes and calls the ranking engine directly once on the changed state. It skips the redundant field-first wait because rankNeighborhoods already builds its field alongside other data. Complex operations can use the eight-decision native tool loop; its independent searches are also parallel.

OpenRouter requests use reasoning effort low with exclude:true. The live model accepted these settings; planning usage is recorded with each benchmark. Genres are represented by one widely known resolved artist/show by default (up to two when requested), with reference_for attribution retained for the final answer. A failed representative is omitted when another for that genre resolved. Wifi/Wi-Fi duplicate preferences are merged; generic cafe work needs only the strongest matching tag. No more than two refinements can be added per request.

After a successful patch there is no extra tool-enabled model turn. A single final call receives confirmed changes, genre references and the top three neighborhoods, requests about 120 tokens and streams content deltas. Text supplied with the successful patch can be reused without that call. The final call waits up to 1.5 seconds for first words, shortened near the 7.8-second response target. Once text starts, a brief completion window (up to 700 ms, bounded by the remaining response budget) lets the sentence finish; slow generation falls back to confirmed server wording. Matching partial prefixes are completed without repeating the sentence. This target does not cut short a still-running engine operation; the whole request, including final generation, has a hard 25-second deadline. Disconnects cancel remaining work.

The benchmark reports measured latency rather than treating passing functional tests as proof of an 8-second SLA. First trace is honest immediate progress (Checking your preferences); first actual tool-action time is reported separately. Timings cover server route/SSE handling, not a remote browser's network latency. See ignored fixtures and chat for the final run.

`tests/agent/live.test.ts` additionally covers text/image intake and engine integration. Its image test needs an ignored visible-books.png containing only DUNE and THE HOBBIT. It does not establish accuracy on crowded bookshelves.

