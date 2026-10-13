"""Checks run on a request before it's sent.

Errors stop the request; warnings are returned for you to read. Each rule comes from TypeSafe's
guidance: every question needs its full text in `instructions` (ids aren't sent); a Choice holds at
most 255 options; a backticked path must exist in the state; one condition per Noul, phrased so that
yes means the thing; leave arithmetic, counting and dates to code.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from question_kit._json import stringify
from question_kit.state import paths, referenced_paths
from question_kit.system_one import MAX_CHOICE_OPTIONS, Entry, Question


@dataclass
class Problem:
    question: str
    level: Literal["error", "warning"]
    message: str


_NEGATIVE = re.compile(r"\bfree of\b|\bdoes not\b|\bdoesn't\b|\bisn't\b|\bis not\b")
_TWO_QUESTIONS = re.compile(r"\?\s*\S.*\?")
_ARITHMETIC = re.compile(r"\bhow many\b|\bcount\b|\bsum of\b|\bdays between\b", re.IGNORECASE)


def lint(state: Entry, questions: dict[str, Question]) -> list[Problem]:
    out: list[Problem] = []
    known = paths(state)
    is_text = isinstance(state, str)
    for qid, qn in questions.items():
        instructions = qn.get("instructions")
        text = instructions if isinstance(instructions, str) else stringify(instructions if instructions is not None else "")

        def err(message: str, qid: str = qid) -> None:
            out.append(Problem(qid, "error", message))

        def warn(message: str, qid: str = qid) -> None:
            out.append(Problem(qid, "warning", message))

        if not text.strip() or text in ('""', "null"):
            err("no instructions: the question id isn't sent, so the instructions must hold the whole question")
        if not is_text:
            own = paths(instructions) if isinstance(instructions, (dict, list)) else set()
            for p in referenced_paths(instructions):
                if p not in known and p not in own:
                    err(f"refers to `{p}`, which isn't in the state")
        if qn["type"] == "choice":
            n = len(qn["criteria"])
            if n < 2:
                err(f"a Choice needs at least 2 options (has {n})")
            if n > MAX_CHOICE_OPTIONS:
                err(f"a Choice holds at most {MAX_CHOICE_OPTIONS} options (has {n}); shortlist or split it first")
        if qn["type"] == "score" and len(qn["criteria"]) < 2:
            err("a Score needs at least 2 levels")
        if qn["type"] == "noul":
            if _NEGATIVE.search(text.lower()):
                warn("phrased in the negative; Nouls read best when yes means the thing you're looking for")
            if _TWO_QUESTIONS.search(text):
                warn("asks more than one question; split it and combine the answers in code")
        if _ARITHMETIC.search(text):
            warn("looks like arithmetic or counting; do that in code and ask one question per item")
    return out


class LintError(Exception):
    """A request that wasn't sent, because the pre-send checks found errors."""

    def __init__(self, problems: list[Problem]) -> None:
        self.problems = problems
        super().__init__("request not sent:\n" + "\n".join(f"  {p.question}: {p.message}" for p in problems))
