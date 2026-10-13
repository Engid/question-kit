"""extract_value: an exact value from the text, picked from candidates code found.

Code finds every candidate (a pattern tuned to over-find, a list of known names, or values you
pass), Jev picks the one in the role you describe or "none", and code copies the picked text and
normalizes it. Jev only ever chooses among spans that are really there, so a value can't be
invented or have a digit swapped.
Based on the approach in TypeSafe's "Pre-parsed value extraction" cookbook.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Optional, Union

from question_kit.questions import choice
from question_kit.readings import read_choice
from question_kit.state import Ref, Text
from question_kit.system_one import MAX_CHOICE_OPTIONS
from question_kit.task import Task, place

# Patterns that over-find on purpose: Jev decides which match is the one asked for. The same
# expressions as the TypeScript package's; `re.ASCII` keeps `\d` and `\b` to ASCII, as in JavaScript.
PATTERNS: dict[str, re.Pattern[str]] = {
    "email": re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", re.ASCII),
    "phone": re.compile(r"\+?\(?\d[\d\s().-]{6,}\d", re.ASCII),
    "amount": re.compile(
        r"[$€£¥]\s?\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?\s?(?:dollars|usd|eur|euros|gbp|pounds)\b",
        re.ASCII | re.IGNORECASE,
    ),
    # Runs of 5 or more digits, optionally with dashes or spaces inside (order, account, tracking numbers).
    "number": re.compile(r"\b[A-Z]{0,4}\d[\d -]{3,}\d\b", re.ASCII),
    "zip": re.compile(r"\b\d{5}(?:-\d{4})?\b", re.ASCII),
}

ValueKind = Union[str, "re.Pattern[str]", dict]
"""A built-in pattern name, your own compiled pattern, `{"names": [...]}`, or `{"candidates": [...]}`."""


@dataclass
class ExtractedValue:
    value: Optional[str]
    """The normalized value, or None when the text doesn't give one."""
    raw: Optional[str]
    """The text exactly as it appears."""
    probability: float
    confidence: float
    candidates: list[str] = field(default_factory=list)


_TRAILING = re.compile(r"[.,;:]+$")


def find_candidates(text: str, kind: ValueKind) -> list[str]:
    """Every candidate in the text for a kind, in order of appearance, without duplicates."""
    if isinstance(kind, dict):
        # Every name is offered: the text may use a nickname or a first name that no simple match
        # would find, and Jev can still answer "none".
        found = list(kind["candidates"] if "candidates" in kind else kind["names"])
    else:
        pattern = kind if isinstance(kind, re.Pattern) else PATTERNS[kind]
        found = [m.group(0) for m in pattern.finditer(text)]
    seen: set[str] = set()
    out: list[str] = []
    for s in found:
        s = _TRAILING.sub("", s.strip())
        if s and s not in seen:
            seen.add(s)
            out.append(s)
    return out


def _normalize(raw: str, kind: ValueKind, country_code: str = "1") -> str:
    if kind == "email":
        return raw.lower()
    if kind == "phone":
        plus = raw.strip().startswith("+")
        digits = re.sub(r"\D", "", raw, flags=re.ASCII)
        if plus:
            return f"+{digits}"
        if country_code == "1" and len(digits) == 11 and digits.startswith("1"):
            return f"+{digits}"
        return f"+{country_code}{digits}"
    if kind == "amount":
        return re.sub(r"[^\d.]", "", raw, flags=re.ASCII)
    if kind in ("number", "zip"):
        return re.sub(r"[\s-]", "", raw)
    return raw.strip()


def extract_value(
    text: Text,
    *,
    kind: ValueKind,
    role: str,
    normalize: Optional[Callable[[str], str]] = None,
    country_code: str = "1",
    source: Optional[str] = None,
    name: str = "text",
) -> Task[ExtractedValue]:
    """An exact value from the text, in the role you describe ("the order number").

    `kind` says how candidates are found. With a `Ref` as `text`, pass the text itself as `source`.
    """
    src = text if isinstance(text, str) else source
    if src is None:
        raise ValueError("extract_value needs the text itself (pass `source` when giving a Ref)")
    candidates = find_candidates(src, kind)
    if len(candidates) > MAX_CHOICE_OPTIONS - 1:
        raise ValueError(f"{len(candidates)} candidates is more than one Choice holds; narrow the text first")
    t = place(text, name)
    none = "none"

    def key_for(c: str) -> str:
        return f"{c} (as written)" if c == none else c

    norm = normalize or (lambda raw: _normalize(raw, kind, country_code))
    # Names and fixed candidates come from a list, not from the text, so the text may refer to them
    # in a shorter form; patterns match the text exactly.
    from_list = isinstance(kind, dict)

    def questions(at):  # type: ignore[no-untyped-def]
        if not candidates:
            return {}
        r: Ref = t.ref(at)
        instructions = (
            f'Which of these is {role}, going by {r}? It counts if the text refers to it in a shorter or different form, like a first name. Choose "none" if it\'s none of them.'
            if from_list
            else f'Which of these is {role}, as given in {r}? Choose "none" if it doesn\'t give {role}.'
        )
        return {"value": choice(instructions, {key_for(c): None for c in candidates}, none=f"None of these is {role}.")}

    def read(a):  # type: ignore[no-untyped-def]
        if not candidates:
            return ExtractedValue(None, None, 1, 1, candidates)
        r = read_choice(a.get("value"))
        if r.value == none:
            return ExtractedValue(None, None, r.probability, r.confidence, candidates)
        raw = next((c for c in candidates if key_for(c) == r.value), r.value)
        return ExtractedValue(norm(raw), raw, r.probability, r.confidence, candidates)

    return Task(parts=t.parts if candidates else {}, questions=questions, read=read)
