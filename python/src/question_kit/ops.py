"""One-question tasks: check a statement, choose an option, rate on a scale.

These are the building blocks the other methods use. Each takes the text it's about (or a Ref to it)
and writes the question so it points at that part of the state: "About `text`: <statement>". To write
the whole question yourself, pass a function of the Ref instead of a string; it gets the path the
text ended up at, so the wording and the state can't drift apart.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Union

from question_kit.questions import Option, choice, noul, score, yes_no_criteria
from question_kit.readings import ChoiceReading, NoulReading, ScoreReading, read_choice, read_noul, read_score
from question_kit.state import Ref, Text
from question_kit.system_one import Entry
from question_kit.task import Task, place

Wording = Union[str, Callable[[Ref], str]]
"""A statement to put after "About `text`:", or the whole question as a function of the text's Ref."""


def about(text: Ref, wording: Wording) -> str:
    """The instructions for a question about `text`: the wording as given, or "About `text`: <wording>"."""
    return wording(text) if callable(wording) else f"About {text}: {wording}"


def check(text: Text, statement: Wording, criteria: dict[str, Entry] | None = None, *, name: str = "text") -> Task[NoulReading]:
    """Is a statement about the text true? Write it so that true is what you're looking for."""
    t = place(text, name)
    return Task(
        parts=t.parts,
        questions=lambda at: {"check": noul(about(t.ref(at), statement), criteria)},
        read=lambda a: read_noul(a.get("check")),
    )


def checks(text: Text, statements: dict[str, Union[Wording, dict]], *, name: str = "text") -> Task[dict[str, NoulReading]]:
    """Several statements about the same text, one Noul each, in one request.

    A statement can be a string, a function of the Ref, or `{"statement": ..., "true": ..., "false": ...}`.
    """
    t = place(text, name)

    def questions(at):  # type: ignore[no-untyped-def]
        r = t.ref(at)
        out = {}
        for sid, s in statements.items():
            spec = s if isinstance(s, dict) else {"statement": s}
            out[sid] = noul(about(r, spec["statement"]), yes_no_criteria(spec.get("true"), spec.get("false")))
        return out

    return Task(parts=t.parts, questions=questions, read=lambda a: {sid: read_noul(a.get(sid)) for sid in statements})


def choose(
    text: Text,
    options: dict[str, Option],
    *,
    question: Wording | None = None,
    none: str | None = "None of these fit.",
    name: str = "text",
) -> Task[ChoiceReading]:
    """Which one option fits the text? A "none" option is added unless `none=None`."""
    t = place(text, name)

    def questions(at):  # type: ignore[no-untyped-def]
        r = t.ref(at)
        instructions = about(r, question) if question else f"Which of these best fits {r}?"
        return {"choice": choice(instructions, options, none=none)}

    return Task(parts=t.parts, questions=questions, read=lambda a: read_choice(a.get("choice")))


def rate(text: Text, question: Wording, levels: list[Entry], *, name: str = "text") -> Task[ScoreReading]:
    """Where does the text fall on ordered levels (lowest first)?"""
    t = place(text, name)
    return Task(
        parts=t.parts,
        questions=lambda at: {"score": score(about(t.ref(at), question), levels)},
        read=lambda a: read_score(a.get("score")),
    )
