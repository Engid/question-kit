"""Building questions.

The three kinds are TypeSafe's: a Choice picks one option, a Noul says how likely a statement is
true, and a Score places the state on ordered levels (https://docs.typesafe.ai/primitives.md). These
helpers add what the docs recommend: a "none" option where the list may not cover the input, and
structured option descriptions (`what`, `not_for`, `examples`) for options that look alike
(https://docs.typesafe.ai/primitives/advanced.md).
"""

from __future__ import annotations

from typing import Union

from question_kit.system_one import ChoiceQuestion, Entry, Json, NoulQuestion, ScoreQuestion

NONE = "none"
"""The id of the "none of these" option that methods add."""

Option = Union[str, None, dict[str, Json]]
"""An option: plain text, a structured description (`{"what", "not_for", "examples"}`), or any JSON object."""


def describe_option(option: Option) -> Entry:
    """An option as it's sent: a spec's `what`, `not_for` and `examples` first, empty ones left out."""
    if option is None or isinstance(option, str):
        return option
    if not isinstance(option.get("what"), str):
        return option
    out: dict[str, Json] = {"what": option["what"]}
    if option.get("not_for"):
        out["not_for"] = option["not_for"]
    if option.get("examples"):
        out["examples"] = option["examples"]
    for k, v in option.items():
        if k not in out and k not in ("not_for", "examples") and v is not None:
            out[k] = v
    return out


def choice(instructions: Entry, options: dict[str, Option], *, none: str | None = None) -> ChoiceQuestion:
    """Pick one option. `none` adds a "none" option with that description."""
    criteria: dict[str, Entry] = {oid: describe_option(o) for oid, o in options.items()}
    if none:
        if NONE in criteria:
            raise ValueError(f'an option is already called "{NONE}"')
        criteria[NONE] = none
    return {"type": "choice", "instructions": instructions, "criteria": criteria}


def noul(instructions: Entry, criteria: dict[str, Entry] | None = None) -> NoulQuestion:
    """A statement that's either true or false. Phrase it so that true means the thing you're looking for."""
    qn: NoulQuestion = {"type": "noul", "instructions": instructions}
    if criteria is not None:
        qn["criteria"] = criteria
    return qn


def score(instructions: Entry, levels: list[Entry]) -> ScoreQuestion:
    """Ordered levels, lowest first."""
    return {"type": "score", "instructions": instructions, "criteria": list(levels)}


def yes_no_criteria(true: Entry = None, false: Entry = None) -> dict[str, Entry] | None:
    """Noul criteria with only the outcomes given (None when neither is), the way the request is sent."""
    if not true and not false:
        return None
    out: dict[str, Entry] = {}
    if true is not None:
        out["true"] = true
    if false is not None:
        out["false"] = false
    return out
