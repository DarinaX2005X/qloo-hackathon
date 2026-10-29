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
node tests/e2e/run.mjs
```

Output:

- `PASS` / `FAIL` and elapsed time for every scenario and subcheck.
- `report/report.md`: scenario table, timings, exact failure messages and screenshot links.
- `report/results.json`: structured subcheck evidence, complete failure stacks, console/page errors and HTTP failures.
- `report/*.png`: representative screenshots and failure evidence.
- Exit code `0` only if all ten scenarios pass; otherwise `1` (also for runner startup failure).

Each run overwrites report files and screenshots with the same names. It does not clean the directory: consult only artifacts linked by the current report. The report directory is already ignored by the project. `report/visual-review.md`, if present, is a manually authored review tied to a specific run timestamp; the runner does not claim to perform that review automatically.

## Coverage

1. Hero recommendation within 20 seconds, then Berlin committed with Enter. New neighborhood names must match the successful Berlin API response and differ from the old recommendation.
2. Hero button navigates to `/explore`, preserving city and tastes in base64url `?s=` state; at least three neighborhood rows appear.
3. Fresh empty Lisbon taste: entering `Radiohead, Fleabag` and Enter creates exactly two resolved URL tastes and visible Music / TV chips.
4. First neighborhood shows at least three places; its first-days plan produces at least six stops.
5. `less touristy`: a new assistant reply has at least 20 characters and Crowd moves above 0.5 within 20 seconds. User echoes and tool traces cannot satisfy the response check.
6. Resolve Succession through the companion UI, then open a URL containing `p=[Succession]`. At least three ranking rows and positive-width visible You / Them bars are required.
7. Share shows `Link copied`, writes the actual current URL to the clipboard, and opening it in a new tab restores the ordered neighborhood list and top-1.
8. A separate 390×844 page: hero document/body/section have no horizontal overflow; explore has working Your taste / Neighborhoods tabs. Desktop viewport: 1440×1000.
9. `qwzxv` creates an unresolved chip and its dialog works; existing results/input remain usable. `Lisbonn` must produce new-city results matching its API response or understandable visible feedback. `/nope` must return HTTP 404 with the exact custom heading and a recovery link.
10. Audit `console.error` and uncaught `pageerror` on every page, including mobile and the restored share tab. Only observed resource 4xx errors matching the exact intentional edge-case request in scenario 9 can be excluded. Unrelated 4xx, all 5xx, JavaScript errors and map errors remain failures. Full errors are retained, including excluded entries.

The run uses one fresh browser context, real production services, and no mocked responses, injected application state or retries of failed scenarios. It waits up to 20 seconds per asynchronous condition. The 20-second Hero budget includes navigation; the agent budget starts at submitting the prompt. Map readiness allows up to 20 seconds and samples real WebGL pixels instead of accepting an empty canvas. Timing for a scenario includes all its steps and screenshot capture, so combined scenarios can exceed 20 seconds.

Failed subchecks do not stop independent later checks. Scenarios 4–9 reuse real resolved URL entities captured in scenario 3; missing prerequisite state produces an explicit dependency failure, never a silent skip or manufactured PASS. Visual screenshots support a separate pixel review; they do not establish human comprehension or user approval. No application fixes are made.
