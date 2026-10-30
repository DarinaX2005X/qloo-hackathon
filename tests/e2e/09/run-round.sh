#!/usr/bin/env bash
# Package Q: one full acceptance round (UI first so the agent rate bucket is fresh, then HTTP, then dialogues).
# Usage: bash tests/e2e/09/run-round.sh <label>     (from project/)
set -u
L=${1:-round}
OUT=${QA_DIR:-C:/Users/user/Desktop/qloo/tasks/09-qa}/rounds/$L
date -u +"start %FT%TZ" > "$OUT.log"
node tests/e2e/09/qa-ui.mjs landing,shortlist,journey,deeplinks,race,visitcard >> "$OUT.log" 2>&1
node tests/e2e/09/qa-http.mjs all >> "$OUT.log" 2>&1
node tests/e2e/09/qa-agent.mjs 1,2,3,4,5 >> "$OUT.log" 2>&1
date -u +"end %FT%TZ" >> "$OUT.log"
grep -cE "^(PASS)" "$OUT.log" | sed 's/^/PASS /'; grep -cE "^(FAIL)" "$OUT.log" | sed 's/^/FAIL /'
