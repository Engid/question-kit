# Contributing

question-kit is in alpha. The APIs will change between 0.x releases, and the best way to help right
now is to try it and tell us what happened.

**Open an issue** for anything: something that broke, something that felt awkward, a use case you
think it should fit, a question that wasn't answered well. The [bug report](.github/ISSUE_TEMPLATE/bug_report.md)
and [feedback](.github/ISSUE_TEMPLATE/feedback.md) templates say what helps. Where you can, include
the request and Jev's answers: with `calls: []` in the options, or the `--trace` flag of the
examples, every request is there to copy.

**Pull requests:** we're not taking feature pull requests yet; open an issue first so we can talk
it over and avoid wasted work. A pull request that fixes a problem you hit in a real use case is
welcome, with a test.

## Working on the repo

```sh
bun install
bun run typecheck && bun test        # offline: unit tests use a fake client
bun run build                        # dist/ for the package, as published
bun run smoke --client record        # live checks of the core methods (needs TYPESAFE_API_KEY)
```

Tests run against the source (the package's `exports` have a `bun` condition pointing at it), so
no build is needed to work on them. Answers from Jev are cached in `.cache/jev`, so re-running a
live example is free; `--replay` on an example uses the cache only.

## Writing

Example content stays with everyday subjects. When a method follows one of TypeSafe's cookbooks,
say which. Numbers in READMEs are only what we've measured, with what they were measured on.
