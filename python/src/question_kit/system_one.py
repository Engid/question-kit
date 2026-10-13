"""The wire format of a System One request, and sending one.

Requests and answers are plain dicts in the shape of TypeSafe's API (`POST /v1/systemone`). Any
object with a `system_one(request)` method works as a client: TypeSafe's SDK wrapped in a few lines
(`question_kit.typesafe`), an answer cache (`question_kit.cache`), or a fake for tests (`fake_jev`).
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol, TypedDict, Union

from typing_extensions import NotRequired

from question_kit._json import js_length, stringify

Json = Union[str, int, float, bool, None, list["Json"], dict[str, "Json"]]
"""Any JSON value."""

Entry = Union[str, dict[str, Json], list[Json], None]
"""Text, a JSON object or array, or None: what state, instructions and descriptions may be."""


class NoulQuestion(TypedDict):
    type: Literal["noul"]
    instructions: Entry
    criteria: NotRequired[dict[str, Entry]]


class ChoiceQuestion(TypedDict):
    type: Literal["choice"]
    instructions: Entry
    criteria: dict[str, Entry]
    """Option id → description (or None)."""


class ScoreQuestion(TypedDict):
    type: Literal["score"]
    instructions: Entry
    criteria: list[Entry]
    """One description per level, lowest first."""


Question = Union[NoulQuestion, ChoiceQuestion, ScoreQuestion]


class SystemOneRequest(TypedDict):
    state: Entry
    questions: dict[str, Question]
    model: NotRequired[str]
    meta: NotRequired[dict[str, Any]]
    """Not part of the API: what each question is about, for logs and fakes. Clients must not send it."""


Answer = dict[str, Any]
"""One answer: `{"noul": p}`, `{"choice": id, "probabilities": {...}}` or `{"score": x, "probabilities": {"0": p, ...}}`."""


class SystemOneResponse(TypedDict):
    answers: dict[str, Answer]
    model: NotRequired[str]
    usage: NotRequired[dict[str, int]]


class SystemOneClient(Protocol):
    """Anything that answers a System One request."""

    def system_one(self, request: SystemOneRequest) -> SystemOneResponse: ...


@dataclass
class SystemOneCall:
    """One request and its answers, for logs, explaining a result, and cost."""

    title: str
    part: int
    """Which request this was, when a big one was split into several."""
    parts: int
    request: SystemOneRequest
    response: SystemOneResponse
    ms: float


# Estimating input tokens before sending: a fixed cost per request plus the request's JSON length
# divided by characters per token (fitted on live requests; these round toward over-estimating).
REQUEST_OVERHEAD_TOKENS = 250
CHARS_PER_TOKEN = 3
MAX_REQUEST_TOKENS = 48_000
"""TypeSafe documents a 64k-token context; stay well under it."""
MAX_CHOICE_OPTIONS = 255
"""TypeSafe's limit on options in one Choice."""
PRICE_PER_MILLION_INPUT = 0.042
"""TypeSafe's list price per million input tokens (output is free)."""


def estimate_tokens(state: Entry, questions: dict[str, Question]) -> float:
    """Estimated input tokens for a request."""
    return REQUEST_OVERHEAD_TOKENS + js_length(stringify({"state": state, "questions": questions})) / CHARS_PER_TOKEN


def send(
    client: SystemOneClient,
    state: Entry,
    questions: dict[str, Question],
    *,
    log: list[SystemOneCall] | None = None,
    title: str | None = None,
    model: str | None = None,
    meta: dict[str, Any] | None = None,
) -> dict[str, Answer]:
    """Ask every question about one state in one request, splitting only if it would be too big.

    Jev answers each question independently, so splitting doesn't change the answers.
    """
    answers: dict[str, Answer] = {}
    if not questions:
        return answers
    parts = _split(state, questions)
    for i, part in enumerate(parts):
        request: SystemOneRequest = {"state": state, "questions": {qid: questions[qid] for qid in part}}
        if model:
            request["model"] = model
        if meta:
            request["meta"] = {qid: meta[qid] for qid in part if qid in meta}
        t0 = time.perf_counter()
        response = client.system_one(request)
        if log is not None:
            log.append(SystemOneCall(title or "", i, len(parts), request, response, (time.perf_counter() - t0) * 1000))
        for qid in part:
            a = response["answers"].get(qid)
            if a is None:
                raise RuntimeError(f'Jev returned no answer for question "{qid}"')
            answers[qid] = a
    return answers


def _split(state: Entry, questions: dict[str, Question]) -> list[list[str]]:
    base = js_length(stringify({"state": state, "questions": {}}))
    out: list[list[str]] = []
    cur: list[str] = []
    chars = base
    for qid, qn in questions.items():
        size = js_length(stringify({qid: qn}))
        if cur and REQUEST_OVERHEAD_TOKENS + (chars + size) / CHARS_PER_TOKEN > MAX_REQUEST_TOKENS:
            out.append(cur)
            cur = []
            chars = base
        cur.append(qid)
        chars += size
    if cur:
        out.append(cur)
    return out


def estimate_cost(log: list[SystemOneCall]) -> float:
    """Estimated cost in dollars of the requests in a log."""
    tokens = 0.0
    for c in log:
        used = (c.response.get("usage") or {}).get("input_tokens")
        tokens += used or estimate_tokens(c.request["state"], c.request["questions"])
    return tokens / 1e6 * PRICE_PER_MILLION_INPUT


FakeAnswer = Union[Answer, str, float, int]


@dataclass
class FakeJev:
    """A client for tests. See `fake_jev`."""

    answer: Callable[[str, Question, Entry], FakeAnswer]
    requests: list[SystemOneRequest] = field(default_factory=list)

    def system_one(self, request: SystemOneRequest) -> SystemOneResponse:
        self.requests.append(request)
        answers = {qid: _expand(qn, self.answer(qid, qn, request["state"])) for qid, qn in request["questions"].items()}
        return {"model": "fake", "answers": answers}


def fake_jev(answer: Callable[[str, Question, Entry], FakeAnswer]) -> FakeJev:
    """A client for tests: `answer(id, question, state)` gives each answer.

    A Choice answer can be just the chosen option, a Noul answer a probability (or "yes"/"no"), and
    a Score answer `{"level": n}` or a level number. A full answer dict is passed through.
    """
    return FakeJev(answer)


def _expand(qn: Question, a: FakeAnswer) -> Answer:
    if isinstance(a, dict) and "level" not in a:
        return a
    if qn["type"] == "noul":
        p = a if isinstance(a, (int, float)) and not isinstance(a, bool) else 0.95 if a in ("yes", "true") else 0.05
        return {"type": "noul", "noul": p}
    if qn["type"] == "choice":
        keys = list(qn["criteria"].keys())
        pick = a if isinstance(a, str) else keys[0]
        rest = (1 - 0.9) / max(1, len(keys) - 1)
        top = 1 if len(keys) == 1 else 0.9
        return {"type": "choice", "choice": pick, "probabilities": {k: top if k == pick else rest for k in keys}}
    n = len(qn["criteria"])
    level = a["level"] if isinstance(a, dict) else a if isinstance(a, (int, float)) else 0
    return {"type": "score", "score": level, "probabilities": {str(i): 1 if i == level else 0 for i in range(n)}}
