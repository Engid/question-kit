"""The core and the methods, offline: requests built, answers read. Ported from the TypeScript tests."""

from __future__ import annotations

import pytest

from question_kit import (
    LintError,
    above,
    band,
    check,
    checks,
    choose,
    classify,
    decide,
    estimate_cost,
    extract_value,
    fake_jev,
    find_candidates,
    lint,
    rank_by_score,
    rate,
    read_choice,
    read_score,
    ref,
    run,
    run_all,
    screen,
)
from question_kit.system_one import SystemOneCall


def choice_answer(probabilities):
    top = max(probabilities, key=probabilities.get)
    return {"type": "choice", "choice": top, "probabilities": probabilities}


# --- readings ---------------------------------------------------------------------------------


def test_choice_reading_and_confidence():
    r = read_choice(choice_answer({"a": 0.7, "b": 0.2, "c": 0.1}))
    assert r.value == "a"
    assert r.ranked[0] == ("a", 0.7)
    assert r.confidence == pytest.approx((0.7 - 1 / 3) / (1 - 1 / 3))


def test_score_reading_orders_levels_numerically():
    r = read_score({"score": 1.7, "probabilities": {"10": 0, "2": 0.7, "0": 0.1, "1": 0.2, "3": 0, "4": 0, "5": 0, "6": 0, "7": 0, "8": 0, "9": 0}})
    assert r.level == 2
    assert r.probabilities[:3] == [0.1, 0.2, 0.7]


def test_band_and_decide():
    assert band(0.2, no=0.3, yes=0.7) == "no"
    assert band(0.5, no=0.3, yes=0.7) == "uncertain"
    r = read_choice(choice_answer({"a": 0.9, "b": 0.1}))
    assert decide(r, {"act": 0.9, "confirm": 0.5}) == "confirm"  # confidence 0.8
    assert decide(r, {"act": 0.9, "confirm": 0.5}, by="probability") == "act"


# --- tasks -------------------------------------------------------------------------------------


def test_run_all_sends_one_request_and_reads_each_task():
    msg = "I want a refund for order 4410982"
    client = fake_jev(lambda qid, q, s: "refund" if q["type"] == "choice" and "refund" in q["criteria"] else ("4410982" if q["type"] == "choice" else 0.1))
    r = run_all(client, {
        "intent": classify(msg, {"refund": "Wants their money back", "track": "Asking where an order is"}),
        "order": extract_value(msg, kind="number", role="the order number"),
        "upset": check(msg, "The customer is upset."),
    })
    assert len(client.requests) == 1
    assert r["intent"].value == "refund"
    assert r["order"].value == "4410982"
    assert r["upset"].value is False
    # The message was sent once; the other tasks point at the first copy.
    assert list(client.requests[0]["state"]) == ["intent"]


def test_run_with_state_and_ref_and_about_goes_to_meta_not_the_wire():
    client = fake_jev(lambda *_: "yes")
    log: list[SystemOneCall] = []
    r = run(client, check(ref("message"), "It's a greeting."), state={"message": "hi"}, about="greeting?", log=log, title="t")
    assert r.value is True
    req = client.requests[0]
    assert req["state"] == {"message": "hi"}
    assert req["questions"]["check"]["instructions"] == "About `message`: It's a greeting."
    assert req["meta"] == {"check": "greeting?"}
    assert log[0].title == "t" and estimate_cost(log) > 0


def test_lint_stops_a_request_with_a_missing_path():
    client = fake_jev(lambda *_: "yes")
    with pytest.raises(LintError):
        run(client, check(ref("nowhere"), "Is it?"), state={"message": "hi"})
    assert client.requests == []


def test_lint_warnings():
    problems = lint({"t": "x"}, {"q": {"type": "noul", "instructions": "About `t`: It is not spam."}})
    assert [p.level for p in problems] == ["warning"]


def test_checks_choose_rate_build_one_question_each():
    client = fake_jev(lambda qid, q, s: {"level": 2} if q["type"] == "score" else ("b" if q["type"] == "choice" else 0.9))
    r = run_all(client, {
        "c": checks("text", {"x": "It's short.", "y": {"statement": "It's long.", "true": "Long."}}),
        "pick": choose("text", {"a": "A", "b": "B"}),
        "r": rate("text", "How long?", ["Short.", "Medium.", "Long."]),
    })
    assert r["c"]["x"].value is True
    assert r["pick"].value == "b"
    assert r["r"].level == 2
    qs = client.requests[0]["questions"]
    assert qs["c::y"]["criteria"] == {"true": "Long."}
    assert "none" in qs["pick::choice"]["criteria"]


# --- classify ----------------------------------------------------------------------------------

LABELS = {
    "track": {"what": "Asking where an order is", "parent": "orders"},
    "cancel": {"what": "Wants to cancel an order", "parent": "orders"},
    "password": {"what": "Can't log in", "parent": "account"},
}


def test_classify_adds_none_and_reads_the_label():
    client = fake_jev(lambda *_: choice_answer({"track": 0.92, "cancel": 0.04, "password": 0.02, "none": 0.02}))
    r = run(client, classify("where is my package", LABELS))
    assert "none" in client.requests[0]["questions"]["label"]["criteria"]
    assert "parent" not in client.requests[0]["questions"]["label"]["criteria"]["track"]
    assert r.value == "track"
    assert r.level == "label"


def test_classify_backs_off_to_the_parent_when_unsure():
    client = fake_jev(lambda *_: choice_answer({"track": 0.45, "cancel": 0.4, "password": 0.1, "none": 0.05}))
    r = run(client, classify("my order", LABELS, backoff_below=0.9))
    assert r.level == "parent"
    assert r.parent == "orders"


# --- extract_value -----------------------------------------------------------------------------


def test_extract_value_finds_candidates_and_normalizes_the_pick():
    text = "Send the receipt to Jane.Doe@Example.com, not to billing@example.com. Call (415) 555-0177."
    assert find_candidates(text, "email") == ["Jane.Doe@Example.com", "billing@example.com"]
    r = run(fake_jev(lambda *_: "Jane.Doe@Example.com"), extract_value(text, kind="email", role="the email address for the receipt"))
    assert r.value == "jane.doe@example.com"
    assert r.raw == "Jane.Doe@Example.com"
    phone = run(fake_jev(lambda *_: "(415) 555-0177"), extract_value(text, kind="phone", role="the phone number"))
    assert phone.value == "+14155550177"


def test_extract_value_none_and_no_request_without_candidates():
    r = run(fake_jev(lambda *_: "none"), extract_value("order 3348917502", kind="number", role="the order number"))
    assert r.value is None
    client = fake_jev(lambda *_: "none")
    empty = run(client, extract_value("no numbers here", kind="number", role="the order number"))
    assert empty.value is None
    assert client.requests == []


def test_extract_value_names_are_all_offered():
    assert find_candidates("hi this is crystal, my order is late", {"names": ["Crystal Minh", "Joyce Wu"]}) == ["Crystal Minh", "Joyce Wu"]


def test_extract_value_with_a_ref_needs_the_source():
    with pytest.raises(ValueError):
        extract_value(ref("message"), kind="number", role="the order number")


# --- screen ------------------------------------------------------------------------------------


def test_screen_applies_the_policy_and_precedence():
    flags = {
        "wants_person": {"statement": "The customer asks to speak to a person.", "action": "handoff"},
        "cancel": {"statement": "The customer says they will cancel.", "action": "retain"},
    }
    client = fake_jev(lambda qid, *_: 0.8 if qid == "wants_person" else 0.5)
    r = run(client, screen("get me a human or I'm cancelling", flags, precedence=["handoff", "retain"]))
    assert r.action == "handoff"
    assert [t.action for t in r.triggered] == ["handoff", "review"]


def test_screen_escalates_review_by_severity():
    flags = {"rude": {"statement": "The message is rude.", "action": "block"}}
    client = fake_jev(lambda qid, q, s: {"level": 2} if q["type"] == "score" else 0.5)
    r = run(client, screen("x", flags, precedence=["block"], policy={"act": 0.7, "review": 0.35, "escalate_at_severity": 2},
                           severity={"question": "How bad?", "levels": ["Fine.", "Bad.", "Awful."]}))
    assert r.action == "block"
    assert r.severity == 2


# --- rank_by_score -----------------------------------------------------------------------------

LEVELS = ["Unrelated.", "Related.", "Partly answers it.", "Answers it exactly."]


def rater(probs):
    def answer(qid, question, state):
        ps = probs[qid]
        return {"type": "score", "score": sum(p * i for i, p in enumerate(ps)), "probabilities": {str(i): ps[i] if i < len(ps) else 0 for i in range(len(question["criteria"]))}}

    return fake_jev(answer)


def test_rank_by_score_one_score_per_item_pointing_at_item_and_query():
    client = rater({"i1": [1, 0, 0, 0], "i2": [0, 0, 0, 1]})
    run(client, rank_by_score(["socks", "bike helmet"], query="bike gear", levels=LEVELS))
    assert len(client.requests) == 1
    assert client.requests[0]["state"] == {"items": {"i1": "socks", "i2": "bike helmet"}, "query": "bike gear"}
    assert client.requests[0]["questions"]["i1"] == {"type": "score", "instructions": "How relevant is `items.i1` to `query`?", "criteria": LEVELS}


def test_rank_by_score_sorts_by_expected_level():
    client = rater({"i1": [0, 0.3, 0, 0.7], "i2": [0, 1, 0, 0], "i3": [0, 0, 0.1, 0.9]})
    r = run(client, rank_by_score(["a", "b", "c"], query="q", levels=LEVELS))
    assert [x.item for x in r.ranked] == ["c", "a", "b"]
    assert r.ranked[0].level == 3 and r.ranked[1].level == 3
    assert r.ranked[0].value == pytest.approx(2.9)
    assert r.ranked[-1].beats_next is None
    assert r.confidence == pytest.approx(above([0, 0, 0.1, 0.9], [0, 0.3, 0, 0.7]))


def test_rank_by_score_question_as_statement_or_function():
    a = rater({"i1": [0, 1], "i2": [1, 0]})
    run(a, rank_by_score(["x", "y"], question="How easy is it to read?", levels=["Hard.", "Easy."]))
    assert a.requests[0]["questions"]["i1"]["instructions"] == "About `items.i1`: How easy is it to read?"
    assert a.requests[0]["state"] == {"items": {"i1": "x", "i2": "y"}}
    b = rater({"i1": [0, 1], "i2": [1, 0]})
    run(b, rank_by_score(["x", "y"], question=lambda item, query: f"Is {item} easy to read?", levels=["Hard.", "Easy."]))
    assert b.requests[0]["questions"]["i2"]["instructions"] == "Is `items.i2` easy to read?"


def test_above_ties_count_half():
    assert above([0, 1], [0, 1]) == 0.5
    assert above([0, 1], [1, 0]) == 1
    assert above([0.5, 0.5], [1, 0]) == 0.75


def test_rank_by_score_needs_levels_and_something_to_rate_by():
    with pytest.raises(ValueError):
        rank_by_score(["a"], query="q", levels=["only"])
    with pytest.raises(ValueError):
        rank_by_score(["a"], levels=LEVELS)
