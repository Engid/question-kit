"""Turning answers into readings: a value, a probability, and a confidence.

Confidence follows TypeSafe's formulas (https://docs.typesafe.ai/confidence.md):

- Choice: (p_max − 1/n) / (1 − 1/n)
- Score:  max(0, 1 − Σ p_i |i − m| / MAD_uniform), m the most likely level
- Noul:   |2p − 1|

A result built from several answers is only as sure as its least sure part.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Literal, Optional, Union

from question_kit.system_one import Answer


@dataclass
class ChoiceReading:
    value: str
    probability: float
    """Probability of the chosen option."""
    confidence: float
    probabilities: dict[str, float]
    ranked: list[tuple[str, float]] = field(default_factory=list)
    """Options from most to least likely."""


@dataclass
class NoulReading:
    value: bool
    """True when the probability is above 0.5."""
    probability: float
    """Probability that the statement is true."""
    confidence: float


@dataclass
class ScoreReading:
    value: float
    """Expected level: the probability-weighted mean of the level numbers (0 = first level)."""
    level: int
    """The most likely level."""
    confidence: float
    probabilities: list[float]
    """Probability of each level, lowest first."""


def read_choice(a: Optional[Answer]) -> ChoiceReading:
    if not a or "probabilities" not in a or "score" in a:
        raise ValueError("expected a Choice answer")
    probabilities: dict[str, float] = dict(a["probabilities"])
    ranked = sorted(probabilities.items(), key=lambda kv: -kv[1])
    value, probability = ranked[0] if ranked else (a["choice"], 1.0)
    return ChoiceReading(value, probability, choice_confidence(list(probabilities.values())), probabilities, ranked)


def read_noul(a: Optional[Answer]) -> NoulReading:
    if not a or "noul" not in a:
        raise ValueError("expected a Noul answer")
    p = a["noul"]
    return NoulReading(p > 0.5, p, noul_confidence(p))


_DIGITS = re.compile(r"^\d+$", re.ASCII)


def read_score(a: Optional[Answer]) -> ScoreReading:
    if not a or "score" not in a:
        raise ValueError("expected a Score answer")
    raw = {str(k): v for k, v in a["probabilities"].items()}
    keys = list(raw)
    ordered = sorted(keys, key=int) if all(_DIGITS.match(k) for k in keys) else keys
    probabilities = [raw.get(k) or 0 for k in ordered]
    level = 0
    for i, p in enumerate(probabilities):
        if p > probabilities[level]:
            level = i
    return ScoreReading(a["score"], level, score_confidence(probabilities), probabilities)


def choice_confidence(ps: list[float]) -> float:
    n = len(ps)
    if n < 2:
        return 1
    return max(0, (max(ps) - 1 / n) / (1 - 1 / n))


def score_confidence(ps: list[float]) -> float:
    n = len(ps)
    if n < 2:
        return 1
    m = 0
    for i, p in enumerate(ps):
        if p > ps[m]:
            m = i
    spread = sum(p * abs(i - m) for i, p in enumerate(ps))
    mad_uniform = sum(abs(i - (n - 1) / 2) for i in range(n)) / n
    return max(0, 1 - spread / mad_uniform)


def noul_confidence(p: float) -> float:
    return abs(2 * p - 1)


def lowest(*confidences: Optional[float]) -> float:
    """The least sure of several confidences (1 when there are none)."""
    xs = [c for c in confidences if c is not None]
    return min(xs) if xs else 1


def band(p: float, *, no: float, yes: float) -> Literal["yes", "no", "uncertain"]:
    """Sort a probability into bands: under `no` → "no", over `yes` → "yes", otherwise "uncertain"."""
    if p < no:
        return "no"
    if p > yes:
        return "yes"
    return "uncertain"


Decision = Literal["act", "confirm", "person"]
Cuts = dict[str, float]


def decide(
    r: ChoiceReading,
    cuts: Union[Cuts, Callable[[str], Cuts]],
    by: Literal["confidence", "probability"] = "confidence",
) -> Decision:
    """What to do with a Choice: "act" at or above `cuts["act"]`, "confirm" at or above `cuts["confirm"]`, else "person"."""
    c = cuts(r.value) if callable(cuts) else cuts
    x = r.confidence if by == "confidence" else r.probability
    return "act" if x >= c["act"] else "confirm" if x >= c["confirm"] else "person"
