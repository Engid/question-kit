"""typesafe_jev through TypeSafe's real SDK, with the HTTP layer mocked: what's sent, and what comes back."""

from __future__ import annotations

import json

import pytest

httpx2 = pytest.importorskip("httpx2")
pytest.importorskip("typesafe_sdk")

from question_kit import check, classify, rank_by_score, run, run_all  # noqa: E402
from question_kit.typesafe import typesafe_jev  # noqa: E402

API_RESPONSE = {
    "model": "jev-1.13.0",
    "usage": {"input_tokens": 321, "output_tokens": 3},
    "answers": {
        "intent::label": {"type": "choice", "choice": "shipping", "confidence": 0.9, "probabilities": {"shipping": 0.93, "refund": 0.05, "none": 0.02}},
        "upset::check": {"type": "noul", "noul": 0.12},
        "rank::i1": {"type": "score", "score": 0.2, "confidence": 0.7, "legend": {"0": "No.", "1": "Yes."}, "probabilities": {"0": 0.8, "1": 0.2}},
        "rank::i2": {"type": "score", "score": 0.9, "confidence": 0.8, "legend": {"0": "No.", "1": "Yes."}, "probabilities": {"0": 0.1, "1": 0.9}},
    },
}


def client_with(handler):
    return typesafe_jev(api_key="test-key", transport=httpx2.MockTransport(handler), retry={"max_retries": 0})


def test_sends_state_and_questions_and_reads_the_answers():
    sent = []

    def handler(request):
        sent.append(json.loads(request.content))
        return httpx2.Response(200, json=API_RESPONSE)

    client = client_with(handler)
    r = run_all(client, {
        "intent": classify("where is my package?", {"shipping": "Where an order is", "refund": "Money back"}),
        "upset": check("where is my package?", "The customer is upset."),
        "rank": rank_by_score(["a", "b"], query="q", levels=["No.", "Yes."]),
    }, about={"intent": "never sent"})
    body = sent[0]
    assert set(body) >= {"state", "questions"}
    assert "meta" not in body
    assert body["questions"]["upset::check"]["instructions"] == "About `intent.text`: The customer is upset."
    assert r["intent"].value == "shipping"
    assert r["upset"].value is False
    assert [x.item for x in r["rank"].ranked] == ["b", "a"]
    assert r["rank"].ranked[0].probabilities == [0.1, 0.9]


def test_the_response_is_plain_json():
    client = client_with(lambda request: httpx2.Response(200, json=API_RESPONSE))
    resp = client.system_one({"state": "x", "questions": {"upset::check": {"type": "noul", "instructions": "Is `x` short?"}}})
    json.dumps(resp)  # nothing SDK-specific left in it
    assert resp["answers"]["rank::i1"]["probabilities"] == {"0": 0.8, "1": 0.2}
    assert resp["usage"]["input_tokens"] == 321


def test_needs_a_key(monkeypatch):
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    with pytest.raises(ValueError):
        typesafe_jev()


def test_run_with_one_task():
    client = client_with(lambda request: httpx2.Response(200, json={"model": "jev", "usage": {"input_tokens": 1, "output_tokens": 1}, "answers": {"check": {"type": "noul", "noul": 0.9}}}))
    assert run(client, check("hi", "It's a greeting.")).value is True
