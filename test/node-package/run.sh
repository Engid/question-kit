#!/usr/bin/env bash
# `bun run check:node-package` and `bun run check:bun-package`: the package as a user gets it.
#
# Builds the package, packs it, installs the tarball with TypeSafe's SDK into a temporary folder
# (with npm for Node, with `bun add` for Bun), and runs check.mjs there: every entry imports, a
# method runs on a fake client, and typesafeJev and openRouter talk to local stand-in servers. No API
# key or network calls to a model.
#
#   bash test/node-package/run.sh          Node (NODE=/path/to/node to try another version)
#   bash test/node-package/run.sh bun      Bun (BUN=/path/to/bun likewise)
set -euo pipefail
runtime="${1:-node}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

sdk="@typesafe-ai/sdk@$(cd "$root" && node -p "require('./packages/question-kit/package.json').peerDependencies['@typesafe-ai/sdk']")"
# TypeScript through Node, wherever the install put it (npx can miss Bun's shims on Windows).
(cd "$root/packages/question-kit" && rm -rf dist && node "$(node -p "require.resolve('typescript/bin/tsc')")" -p tsconfig.build.json)
tarball="$(cd "$root/packages/question-kit" && npm pack --silent --pack-destination "$tmp" | tail -1)"
cp "$root/test/node-package/check.mjs" "$tmp/"
cd "$tmp"
echo '{"name":"package-check","version":"1.0.0","type":"module","private":true}' > package.json
case "$runtime" in
  node)
    node="${NODE:-node}"
    echo "node $("$node" --version), $sdk"
    npm install --silent --no-audit --no-fund "./$tarball" "$sdk"
    "$node" check.mjs ;;
  bun)
    bun="${BUN:-bun}"
    echo "bun $("$bun" --version), $sdk"
    "$bun" add --silent "./$tarball" "$sdk" >/dev/null
    "$bun" check.mjs ;;
  *) echo "usage: run.sh [node|bun]" >&2; exit 2 ;;
esac
