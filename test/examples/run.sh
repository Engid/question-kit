#!/usr/bin/env bash
# `bun run examples:bun` and `bun run examples:node`: every example and the smoke checks, on one
# runtime, with no API key and no cost. The fake and dry runs always run. The examples that need
# Jev run from the answer cache (.cache/jev); one whose answers aren't cached yet is reported as
# skipped, not failed (record them once with a key: `bun run triage`, and so on).
#
#   bash test/examples/run.sh bun
#   bash test/examples/run.sh node        (Node 22.18 or later)
set -uo pipefail
runtime="${1:-bun}"
cd "$(dirname "$0")/../.."
case "$runtime" in
  bun) run=(bun) ;;
  node) run=(node --import ./scripts/node-source.mjs) ;;
  *) echo "usage: run.sh bun|node" >&2; exit 2 ;;
esac
# A time limit per run where there's a tool for it (macOS has none built in; Homebrew's coreutils
# has gtimeout). The ${limit[@]+…} form keeps an empty list safe under `set -u` in bash 3.2.
if command -v timeout > /dev/null 2>&1; then limit=(timeout 120)
elif command -v gtimeout > /dev/null 2>&1; then limit=(gtimeout 120)
else limit=(); fi
echo "examples on $runtime $("${run[0]}" --version)"
failed=0
ok() { echo "ok    $1"; }
fail() { echo "FAIL  $1"; echo "$2" | tail -15 | sed 's/^/      /'; failed=1; }

# check <name> <pattern the output must contain> <stdin> <args…>
check() {
  local name="$1" want="$2" input="$3"; shift 3
  local out; out="$(printf '%b' "$input" | ${limit[@]+"${limit[@]}"} "${run[@]}" "$@" 2>&1)"; local code=$?
  if [[ "$want" == "@replay" && ( "$out" == *"isn't cached"* || "$out" == *"not cached"* ) ]]; then echo "skip  $name (answers not cached here)"; return; fi
  if [[ $code -ne 0 ]]; then fail "$name (exit $code)" "$out"; return; fi
  if [[ "$want" != "@replay" && "$out" != *"$want"* ]]; then fail "$name (no \"$want\" in the output)" "$out"; return; fi
  ok "$name"
}

check "smoke, dry run" "requests, about" "" smoke/run.ts --client dry
# smoke from the cache, per Jev version: every answer cached is a pass, none cached a skip, some a
# failure (the cache keys moved).
for model in jev-1.13.0 jev-1.14.0; do
  out="$(${limit[@]+"${limit[@]}"} "${run[@]}" smoke/run.ts --model "$model" 2>&1)"
  counts="$(echo "$out" | grep -o 'cache: [0-9]* hits, [0-9]* misses' | tail -1)"
  hits="$(echo "$counts" | awk '{print $2}')"; misses="$(echo "$counts" | awk '{print $4}')"
  if [[ -z "$counts" ]]; then fail "smoke on $model, from the cache" "$out"
  elif [[ "$hits" == 0 ]]; then echo "skip  smoke on $model, from the cache (answers not cached here)"
  elif [[ "$misses" != 0 ]]; then fail "smoke on $model, from the cache ($counts)" "$out"
  else ok "smoke on $model, from the cache ($hits answers; $(echo "$out" | grep -oE 'all: [0-9]+/[0-9]+ right' | tail -1))"; fi
done
check "pizza shop, scripted conversations (fake)" "of 37 right" "" examples/pizza-shop/check.ts --client fake
check "pizza shop, chat (fake)" "requests (to the stand-in)" "a large pepperoni pizza please\n\n" examples/pizza-shop/chat.ts --fake --quiet
check "pizza shop, chat (from the cache)" "@replay" "a large pepperoni pizza please\n\n" examples/pizza-shop/chat.ts --replay --quiet
check "triage (from the cache)" "@replay" "" examples/triage/triage.ts --replay
check "service agent, chat (from the cache)" "@replay" "hi, where is my order?\n\n" examples/service-agent/chat.ts --replay
check "order taker (from the cache)" "@replay" "" examples/order/pizza/take-order.ts "two large pizzas with extra cheese and no onions and a diet coke" --replay

# The pizza web server: start it on a free port, ask for each route, stop it.
port=$((20000 + RANDOM % 20000))
"${run[@]}" examples/pizza-shop/web/server.ts --fake --port "$port" > /tmp/qk-web-$$.log 2>&1 &
pid=$!
for _ in $(seq 1 80); do curl -s "localhost:$port/mode" > /dev/null 2>&1 && break; sleep 0.25; done
web="$(curl -s -o /dev/null -w '%{http_code}' "localhost:$port/") $(curl -s -o /dev/null -w '%{http_code}' "localhost:$port/app.js") $(curl -s "localhost:$port/mode")"
answer="$(curl -s -X POST "localhost:$port/systemone" -H 'content-type: application/json' -d '{"state":"a large pepperoni","questions":{"q":{"type":"noul","instructions":"Is this an order?"}}}')"
kill "$pid" 2> /dev/null; wait "$pid" 2> /dev/null
if [[ "$web" == '200 200 {"mode":"fake"}' && "$answer" == *'"answers"'* ]]; then ok "pizza shop, web server (fake)"; else fail "pizza shop, web server (fake)" "$web $answer $(cat /tmp/qk-web-$$.log)"; fi
rm -f /tmp/qk-web-$$.log

exit $failed
