"""The Python port sends byte-for-byte the requests the TypeScript package sends.

tests/fixtures/parity.json is written by scripts/parity-fixtures.ts from the TypeScript core. Each
case here builds the same request with question_kit; the state, the questions and the cache key must
match exactly, which is what lets the two languages share one answer cache.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from question_kit import check, checks, choose, classify, extract_value, rank_by_score, rate, ref, request, request_all, screen
from question_kit._json import stringify
from question_kit.cache import cache_key

FIXTURES = json.loads((Path(__file__).parent / "fixtures" / "parity.json").read_text(encoding="utf-8"))

MESSAGE = 'Hi, order 4410982 was due "last Friday" and it still isn\'t here.\nCall me at (479) 555-0100 or email Ana.Diaz@Example.com 🙂'
LEVELS = ["Unrelated to the query.", "Related, but doesn't answer it.", "Answers part of it.", "Answers it exactly."]


def one(task):
    return request(task)


CASES = {
    "classify/plain": lambda: one(classify(MESSAGE, {"shipping": "Where an order is", "refund": "Money back for an order"})),
    "classify/specs": lambda: one(
        classify(
            MESSAGE,
            {
                "where_is_it": {"what": "Asking where an order is.", "examples": ["where's my order?", "it was due Friday"], "parent": "orders"},
                "cancel": {"what": "Wants to cancel an order.", "not_for": "returning something delivered", "examples": ["cancel order 4410982"], "parent": "orders"},
                "question": {"what": "A question about the store.", "not_for": "one of their own orders", "examples": []},
            },
            question="Which queue should this go to?",
            none="Something else.",
            backoff_below=0.9,
        )
    ),
    "classify/no-none": lambda: one(classify("hello", {"a": "A", "b": "B"}, none=None)),
    "extractValue/number": lambda: one(extract_value(MESSAGE, kind="number", role="the order number")),
    "extractValue/email": lambda: one(extract_value(MESSAGE, kind="email", role="the email for the receipt")),
    "extractValue/phone": lambda: one(extract_value(MESSAGE, kind="phone", role="the phone number")),
    "extractValue/names": lambda: one(extract_value("dave said hi", kind={"names": ["David Minh", "Crystal Minh", "none"]}, role="the customer's name")),
    "extractValue/regex": lambda: one(extract_value("codes AB-1234 and CD-5678.", kind=re.compile(r"[A-Z]{2}-\d{4}"), role="the code to refund")),
    "extractValue/empty": lambda: one(extract_value("no numbers here", kind="number", role="the order number")),
    "screen/flags": lambda: one(
        screen(
            MESSAGE,
            {
                "wants_person": {"statement": "The customer asks to talk to a person.", "action": "person"},
                "will_leave": {"statement": "The customer says they will stop shopping here.", "true": "They say they're leaving.", "action": "retain"},
            },
            precedence=["person", "retain"],
            severity={"question": "How upset is the customer?", "levels": ["Calm.", "Annoyed.", "Angry."]},
        )
    ),
    "rankByScore/query": lambda: one(
        rank_by_score(
            ["Reset it from the login page.", {"title": "Shipping", "body": "5 to 7 days"}, 42, 2.5, 1e-7, True, None],
            query="how do I reset my password?",
            levels=LEVELS,
        )
    ),
    "rankByScore/question": lambda: one(rank_by_score(["a", "b"], question="How formal is it?", levels=[{"level": "casual"}, {"level": "formal"}], name="texts")),
    "rankByScore/function": lambda: one(
        rank_by_score(["a", "b", "c"], query={"q": "x"}, question=lambda item, query: f"Is {item} a better answer to {query} than most?", levels=["No.", "Yes."])
    ),
    "check": lambda: one(check(MESSAGE, "The customer is upset.", {"true": "Upset.", "false": "Calm."})),
    "check/function": lambda: one(check("text here", lambda t: f"Is {t} written in English?")),
    "checks": lambda: one(
        checks(
            MESSAGE,
            {
                "upset": "The customer is upset.",
                "late": {"statement": "The order is late.", "true": "It's late."},
                "whole": lambda t: f"Does {t} mention a phone number?",
            },
        )
    ),
    "choose/default": lambda: one(choose(MESSAGE, {"a": "Option A", "b": {"what": "Option B", "examples": ["b!"]}})),
    "choose/question": lambda: one(choose(MESSAGE, {"a": "A", "b": "B"}, question=lambda t: f"Pick for {t}.", none=None)),
    "rate": lambda: one(rate(MESSAGE, "How urgent is it?", ["Not urgent.", "Somewhat.", "Very."])),
    "requestAll/triage": lambda: request_all(
        {
            "intent": classify(ref("message"), {"shipping": "Where an order is", "refund": "Money back"}, backoff_below=0.9),
            "order": extract_value(ref("message"), kind=re.compile(r"\b\d{7}\b"), role="the customer's order number", source=MESSAGE),
            "flags": screen(ref("message"), {"wants_person": {"statement": "The customer asks for a person.", "action": "person"}}, precedence=["person"]),
        },
        state={"message": MESSAGE},
    ),
    "requestAll/shared-text": lambda: request_all(
        {
            "a": check(MESSAGE, "The customer is upset."),
            "b": choose(MESSAGE, {"x": "X", "y": "Y"}),
            "c": rate("other text", "How long is it?", ["Short.", "Long."]),
        }
    ),
}


def test_every_fixture_has_a_case():
    assert sorted(CASES) == sorted(FIXTURES)


@pytest.mark.parametrize("name", sorted(FIXTURES))
def test_same_request_as_typescript(name):
    want = FIXTURES[name]
    state, questions = CASES[name]()
    assert stringify(state) == stringify(want["state"])
    assert stringify(questions) == stringify(want["questions"])
    assert cache_key({"state": state, "questions": questions}) == want["key"]
    assert cache_key({"state": state, "questions": questions, "model": "jev-1.13.0"}) == want["keyWithModel"]
