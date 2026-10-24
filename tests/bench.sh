#!/bin/bash
# tests/bench.sh DEALS-EACH KITTY(1|0) [BASE] [TUNE-JSON] — 14 runs at once, summed.
cd "$(dirname "$0")/.."
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
OUT=$(mktemp -d)
TUNE=${4:-}
[ -n "$TUNE" ] || TUNE="{}"
for c in $(seq 0 13); do $JSC tests/args.js -m tests/bench.js -- "$1" $c "$2" "${3:-bot_v1}" "$TUNE" > $OUT/$c.txt 2>&1 & done
wait
cat $OUT/*.txt | python3 tests/bench-sum.py
grep -h -v '^{' $OUT/*.txt | head -3
