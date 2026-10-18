#!/usr/bin/env bash
# `bun run check:node-package`: the package as a user gets it, under Node.
#
# Builds the package, packs it, installs the tarball with TypeSafe's SDK 0.6 into a temporary folder,
# and runs check.mjs there with Node: every entry imports, a method runs on a fake client, and
# typesafeJev and openRouter talk to local stand-in servers. No API key or network calls to a model.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

node="${NODE:-node}"   # NODE=/path/to/node to try another version
echo "node $("$node" --version)"
(cd "$root/packages/question-kit" && rm -rf dist && npx --no-install tsc -p tsconfig.build.json)
tarball="$(cd "$root/packages/question-kit" && npm pack --silent --pack-destination "$tmp" | tail -1)"
cp "$root/test/node-package/check.mjs" "$tmp/"
cd "$tmp"
echo '{"name":"node-package-check","version":"1.0.0","type":"module","private":true}' > package.json
npm install --silent --no-audit --no-fund "./$tarball" "@typesafe-ai/sdk@^0.6.0"
"$node" check.mjs
