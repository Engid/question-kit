"""A live check against Jev before a release: one request through every method in the package.

    cd python
    uv run --env-file ../.env scripts/live_check.py      # needs TYPESAFE_API_KEY (here, from the repo's .env)
    uv run scripts/live_check.py --fake                  # no key: a stand-in client, to check the script itself

It sends one request (a fraction of a cent) and prints what came back. Every line should look
sensible: the intent is "shipping", the order number is 4410982, the customer isn't asking for a
person, and the helmet ranks above the socks. It exits non-zero if any of those doesn't hold.
"""

from __future__ import annotations

import sys

from question_kit import check, classify, estimate_cost, extract_value, fake_jev, rank_by_score, ref, run_all, screen
from question_kit.system_one import SystemOneCall

TEXT = "Hi, my order 4410982 was supposed to arrive last Friday and it still isn't here. Can you check where it is?"


def main() -> int:
    if "--fake" in sys.argv:
        def answer(qid, question, state):
            if question["type"] == "choice":
                return "shipping" if "shipping" in question["criteria"] else "4410982"
            if question["type"] == "score":
                return {"level": 3 if qid.endswith("i2") else 0}
            return 0.1
        client = fake_jev(answer)
    else:
        from question_kit.typesafe import typesafe_jev
        client = typesafe_jev()

    log: list[SystemOneCall] = []
    message = ref("message")
    r = run_all(client, {
        "intent": classify(message, {
            "shipping": {"what": "Asking where an order is or when it will arrive.", "examples": ["where's my order?"]},
            "refund": {"what": "Wants money back for an order.", "examples": ["I want a refund"]},
        }),
        "order": extract_value(message, kind="number", role="the customer's order number", source=TEXT),
        "upset": check(message, "The customer is angry."),
        "flags": screen(message, {"person": {"statement": "The customer asks to talk to a person.", "action": "handoff"}}, precedence=["handoff"]),
        "rank": rank_by_score(["wool socks", "bike helmet"], query="gear for riding a bike",
                              levels=["Unrelated.", "Loosely related.", "Useful for it.", "Exactly what's needed."]),
    }, state={"message": TEXT}, log=log, title="live check")

    print(f"intent  {r['intent'].value}  ({r['intent'].confidence:.2f})")
    print(f"order   {r['order'].value}  ({r['order'].confidence:.2f}; candidates {r['order'].candidates})")
    print(f"upset   {r['upset'].value}  (p={r['upset'].probability:.2f})")
    print(f"flags   {r['flags'].action}  {r['flags'].flags}")
    print(f"rank    {[x.item for x in r['rank'].ranked]}  (expected levels {[round(x.value, 2) for x in r['rank'].ranked]})")
    model = log[0].response.get("model", "?")
    print(f"\n{len(log)} request to {model}, about ${estimate_cost(log):.5f}")

    ok = (
        r["intent"].value == "shipping"
        and r["order"].value == "4410982"
        and r["flags"].action == "pass"
        and r["rank"].ranked[0].item == "bike helmet"
    )
    print("OK" if ok else "Something looks off: check the lines above.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
