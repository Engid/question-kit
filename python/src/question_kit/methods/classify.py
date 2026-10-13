"""classify: which label fits, and the broader label when the model isn't sure.

One Choice over the labels, with a "none" option when the list may not cover the input. If a label
has a parent and the answer's confidence is under `backoff_below`, the result is the parent: a broad
answer you can trust instead of a narrow one you can't, with no second request.
Based on the approach in TypeSafe's "Classification using confidence" cookbook.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional, Union

from question_kit.questions import NONE, Option, choice
from question_kit.readings import ChoiceReading, read_choice
from question_kit.state import Text
from question_kit.task import Task, place

Label = Union[str, dict]
"""A label: a description, or `{"what": ..., "not_for": ..., "examples": [...], "parent": ...}`."""


@dataclass
class Classified(ChoiceReading):
    level: Literal["label", "parent"] = "label"
    """"label" for the label itself, "parent" when it backed off."""
    parent: Optional[str] = None
    """The parent label, when the answer backed off to it."""


def classify(
    text: Text,
    labels: dict[str, Label],
    *,
    question: Optional[str] = None,
    none: Optional[str] = "None of these fit.",
    backoff_below: Optional[float] = None,
    name: str = "text",
) -> Task[Classified]:
    """Which label fits the text?

    Write labels with a couple of real examples each, a `not_for` for look-alikes, and a `parent`
    to back off to with `backoff_below`.
    """
    t = place(text, name)
    options: dict[str, Option] = {}
    for lid, label in labels.items():
        options[lid] = {k: v for k, v in label.items() if k != "parent"} if isinstance(label, dict) else label

    def questions(at):  # type: ignore[no-untyped-def]
        r = t.ref(at)
        instructions = f"About {r}: {question}" if question else f"Which of these best describes {r}?"
        return {"label": choice(instructions, options, none=none)}

    def read(a):  # type: ignore[no-untyped-def]
        r = read_choice(a.get("label"))
        label = None if r.value == NONE else labels.get(r.value)
        parent = label.get("parent") if isinstance(label, dict) else None
        backed_off = bool(parent) and backoff_below is not None and r.confidence < backoff_below
        return Classified(
            r.value, r.probability, r.confidence, r.probabilities, r.ranked,
            level="parent" if backed_off else "label",
            parent=parent if backed_off else None,
        )

    return Task(parts=t.parts, questions=questions, read=read)
