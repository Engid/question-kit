"""Naming the parts of the state, and pointing questions at them.

TypeSafe's guidance: give the state named parts, and when a question is about one of them, name it in
the instructions with its dotted path in backticks (https://docs.typesafe.ai/concepts/state.md). A
`Ref` is such a path, and formats as one, so an f-string writes it for you:

    f"Which order in {orders} is {message} about?"   # "Which order in `orders` is `message` about?"
"""

from __future__ import annotations

import re
from typing import Union

from question_kit._json import stringify
from question_kit.system_one import Entry, Json


class Ref:
    """A dotted path to a part of the state, written in questions as `path`."""

    __slots__ = ("path",)

    def __init__(self, path: str) -> None:
        self.path = path

    def at(self, key: str | int) -> Ref:
        """A part inside this one: `ref("orders").at("o2")` is `orders.o2`."""
        return Ref(f"{self.path}.{key}" if self.path else str(key))

    def __str__(self) -> str:
        return f"`{self.path}`"

    def __repr__(self) -> str:
        return f"Ref({self.path!r})"

    def __eq__(self, other: object) -> bool:
        return isinstance(other, Ref) and other.path == self.path

    def __hash__(self) -> int:
        return hash(self.path)


def ref(path: str) -> Ref:
    return Ref(path)


Text = Union[str, Ref]
"""Text, or a reference to text already in the state."""


def keyed(items: list[Json], prefix: str) -> dict[str, Json]:
    """A list as an object with addressable keys: `keyed(["a", "b"], "o")` is `{"o1": "a", "o2": "b"}`."""
    return {f"{prefix}{i + 1}": item for i, item in enumerate(items)}


def paths(state: Entry) -> set[str]:
    """Every dotted path that exists in a state (objects only; arrays by index)."""
    out: set[str] = set()

    def walk(v: Json, prefix: str) -> None:
        if prefix:
            out.add(prefix)
        if isinstance(v, list):
            for i, x in enumerate(v):
                walk(x, f"{prefix}.{i}" if prefix else str(i))
        elif isinstance(v, dict):
            for k, x in v.items():
                walk(x, f"{prefix}.{k}" if prefix else k)

    if isinstance(state, (dict, list)):
        walk(state, "")
    return out


_PATH = re.compile(r"`([A-Za-z_][\w-]*(?:\.[\w-]+)*)`", re.ASCII)


def referenced_paths(text: Entry) -> list[str]:
    """The backticked paths a piece of question text refers to."""
    s = text if isinstance(text, str) else stringify(text if text is not None else "")
    return _PATH.findall(s)
