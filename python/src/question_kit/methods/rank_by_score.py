"""rank_by_score: put items in order by rating each one on levels you write, then sorting.

One Score per item, all in one request. Jev answers a Score with a probability for every level, so
each item gets an expected level (70% level 3, 25% level 2 and 5% level 1 is 2.65), and items are
sorted by that. Sorting by the expected level instead of the single most likely level is what makes
this work: items that share a most likely level still come apart by how sure Jev was.

In our evals it ordered lists about as well as pairwise comparison, and better on some, for fewer
questions, and it ordered whole lists much better than one Choice over all the items.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Optional, Union

from question_kit.questions import score
from question_kit.readings import ScoreReading, read_score
from question_kit.state import Ref, keyed
from question_kit.system_one import Entry, Json
from question_kit.task import Task


@dataclass
class ScoredItem(ScoreReading):
    item: Any = None
    index: int = 0
    """Position in the input list."""
    key: str = ""
    """The item's key in the state (`i1`, `i2`, …)."""
    beats_next: Optional[float] = None
    """The chance this item's level is above the next one's, a tie counting half; None for the last."""


@dataclass
class ScoreRanking:
    ranked: list[ScoredItem] = field(default_factory=list)
    """Best first: highest expected level; equal values keep input order."""
    confidence: float = 1
    """`beats_next` of the top item (1 when there's one item)."""


def above(a: list[float], b: list[float]) -> float:
    """The chance a level drawn from `a` is above one drawn from `b`, ties counting half."""
    p = 0.0
    for i, pa in enumerate(a):
        for j, pb in enumerate(b):
            p += pa * pb * (1 if i > j else 0.5 if i == j else 0)
    return p


Question = Union[str, Callable[[Ref, Optional[Ref]], str]]


def rank_by_score(
    items: list[Json],
    *,
    levels: list[Entry],
    question: Optional[Question] = None,
    query: Json = None,
    name: str = "items",
) -> Task[ScoreRanking]:
    """Rank items by a Score each, sorted by expected level.

    `levels` go lowest first, each a sentence saying what the level means. `query` is what the items
    are judged against (sent once). `question` is a statement after "About `items.i3`:", or the
    whole question as a function of the item's Ref and the query's.
    """
    if len(levels) < 2:
        raise ValueError("rank_by_score needs at least 2 levels")
    if question is None and query is None:
        raise ValueError("rank_by_score needs `question` or `query` to say what's being rated")
    keys = [f"i{i + 1}" for i in range(len(items))]
    parts: dict[str, Json] = {name: keyed(items, "i")}
    if query is not None:
        parts["query"] = query

    def questions(at):  # type: ignore[no-untyped-def]
        q_ref = at("query") if query is not None else None
        out = {}
        for k in keys:
            item = at(name).at(k)
            if callable(question):
                text = question(item, q_ref)
            elif question is not None:
                text = f"About {item}: {question}"
            else:
                text = f"How relevant is {item} to {q_ref}?"
            out[k] = score(text, levels)
        return out

    def read(answers):  # type: ignore[no-untyped-def]
        scored = []
        for index, (item, k) in enumerate(zip(items, keys, strict=True)):
            r = read_score(answers.get(k))
            scored.append(ScoredItem(r.value, r.level, r.confidence, r.probabilities, item=item, index=index, key=k))
        ranked = sorted(scored, key=lambda s: (-s.value, s.index))
        for i in range(len(ranked) - 1):
            ranked[i].beats_next = above(ranked[i].probabilities, ranked[i + 1].probabilities)
        top = ranked[0].beats_next if ranked else None
        return ScoreRanking(ranked, top if top is not None else 1)

    return Task(parts=parts, questions=questions, read=read)
