# A support inbox, sorted with the core

Six made-up messages to an outdoor-gear store, each read in one request (`classify`,
`extractValue`, `extractDate` and `screen` together with `runAll`), with a `search` of the store's
FAQ for questions about the store. Code acts only on readings over a confidence; the rest goes to a
person with what Jev did read. [The tutorial](../../docs/tutorials/triage.md) builds it up piece by
piece.

```sh
bun run triage              # on live Jev; answers are cached in .cache/jev
bun run triage --verbose    # also print every reading with its confidence
bun run triage --replay     # cached answers only (never calls the API)
```

On Node 22.18 or later: `npm run triage:node`, with the same options after `--`.

It needs `TYPESAFE_API_KEY` in `.env` for the first run. It makes one request per message, plus
one for each question the FAQ is searched for: a small fraction of a cent, printed at the end.
