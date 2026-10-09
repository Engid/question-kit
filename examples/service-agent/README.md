# A store's support chat, built with question-kit/service-agent

A made-up outdoor-gear store's customer service ([store.ts](store.ts)) and a terminal chat with
it ([chat.ts](chat.ts)), on live Jev. The library and every option are documented in
[`packages/question-kit/service-agent`](../../packages/question-kit/service-agent/README.md).

```sh
bun run service:chat            # type as the customer; an empty line ends the chat
bun run service:chat --gates    # also print each reading Jev made and what its gate did
bun run service:chat --replay   # cached answers only (never calls the API)
```

It needs `TYPESAFE_API_KEY` in `.env`. Each turn makes one to three requests, and the chat prints
what it cost when it ends (well under a cent at $0.042 per million input tokens).

## What it shows

| Ask for | What happens |
| --- | --- |
| A return or refund | The agent looks up the order (order ID and email), then Jev reads the store's written policy and what the lookup found, and picks a refund, store credit or neither. A damaged item gets a refund; an item delivered in the last 30 days, store credit; older, neither. Any change is read back first. |
| Faster delivery | The lookup says whether the order has shipped. Jev changes the speed only if it hasn't, as the policy says; you confirm the new speed. |
| A password reset | One value (your email), then the reset link. |

The made-up orders:

| Order ID | Email | Item | Status |
| --- | --- | --- | --- |
| 1234567890 | ana@example.com | hiking boots, $120 | delivered 12 days ago |
| 5550001111 | ana@example.com | rain jacket, $85 | not shipped yet |
| 9876543210 | sam@example.com | two-person tent, $240 | delivered 45 days ago |

Things to try: give the order ID and email in your first message, or only when asked; say the boots
arrived torn, or that you just don't like them; correct a detail when the agent reads a change back
("no, make it express"); answer "anything else?" with something the store doesn't do. Lines in
square brackets are what the order system reports; the agent reads them, but replies only in its
templates, so it won't say the order's status in words.
