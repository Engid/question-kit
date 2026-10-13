"""Tasks: a set of questions plus the code that reads their answers.

Every one-request method returns a `Task`. `run` sends one; `run_all` sends several in a single
request, because TypeSafe recommends asking everything about the same state at once
(https://docs.typesafe.ai/cookbooks/parallel_questions.md). Each task's own state parts go under its
name, and its question ids are prefixed with it, so tasks never collide. A value several tasks share
is sent once.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Generic, TypeVar

from question_kit._json import stringify
from question_kit.lint import LintError, Problem, lint
from question_kit.state import Ref, Text
from question_kit.system_one import Answer, Entry, Json, Question, SystemOneCall, SystemOneClient, send

T = TypeVar("T")

At = Callable[[str], Ref]
"""Given one of a task's own part names, where that part ended up in the state."""


@dataclass
class Task(Generic[T]):
    parts: dict[str, Json]
    """State this task adds, relative to where it's placed."""
    questions: Callable[[At], dict[str, Question]]
    """The questions, given a way to point at the task's own parts."""
    read: Callable[[dict[str, Answer]], T]
    """Read the answers (keyed by this task's own ids) into a result."""


def request(task: Task[Any], *, state: dict[str, Json] | None = None) -> tuple[Entry, dict[str, Question]]:
    """The state and questions for a task, without sending anything."""
    full = {**(state or {}), **task.parts}
    return full, task.questions(Ref)


def run(
    client: SystemOneClient,
    task: Task[T],
    *,
    state: dict[str, Json] | None = None,
    about: Any = None,
    warnings: list[Problem] | None = None,
    log: list[SystemOneCall] | None = None,
    title: str | None = None,
    model: str | None = None,
    meta: dict[str, Any] | None = None,
) -> T:
    """Send one task and read its answers.

    `state` is sent along with the task's own parts (for tasks that point at it with Refs); `about`
    is kept in the request's `meta` under each question id and never sent; pre-send warnings are
    appended to `warnings` (errors raise `LintError`); every request is appended to `log`.
    """
    full, questions = request(task, state=state)
    _check(full, questions, warnings)
    meta = _with_meta(meta, about is not None, [(qid, about) for qid in questions])
    answers = send(client, full, questions, log=log, title=title, model=model, meta=meta)
    return task.read(answers)


def request_all(tasks: dict[str, Task[Any]], *, state: dict[str, Json] | None = None) -> tuple[Entry, dict[str, Question]]:
    """The state and questions for several tasks sent together.

    A value several tasks were given (the customer's message, say) is sent once: the first task to
    bring it keeps it under its own name, and the others point their questions at that copy. A task
    value equal to a top-level part of `state` points there instead. Two parts of the same task are
    never merged, even when equal, so a task comparing `a` with `b` still names both.
    """
    full: dict[str, Json] = dict(state or {})
    questions: dict[str, Question] = {}
    seen: dict[str, str] = {}
    for key, value in full.items():
        seen.setdefault(stringify(value), key)
    for name, task in tasks.items():
        if "::" in name or "." in name:
            raise ValueError(f'task name "{name}" can\'t contain "::" or "."')
        own: dict[str, Json] = {}
        where: dict[str, str] = {}
        js = {part: stringify(value) for part, value in task.parts.items()}

        def repeated(part: str, js: dict[str, str] = js) -> bool:
            return any(p != part and j == js[part] for p, j in js.items())

        for part, value in task.parts.items():
            first = None if repeated(part) else seen.get(js[part])
            if first is not None:
                where[part] = first
            else:
                own[part] = value
                where[part] = f"{name}.{part}"
        for part in own:
            seen.setdefault(js[part], where[part])
        if own:
            if name in full:
                raise ValueError(f'task name "{name}" collides with a state part')
            full[name] = own
        qs = task.questions(lambda part, where=where, name=name: Ref(where.get(part, f"{name}.{part}")))
        for qid, qn in qs.items():
            questions[f"{name}::{qid}"] = qn
    return full, questions


def run_all(
    client: SystemOneClient,
    tasks: dict[str, Task[Any]],
    *,
    state: dict[str, Json] | None = None,
    about: dict[str, Any] | None = None,
    warnings: list[Problem] | None = None,
    log: list[SystemOneCall] | None = None,
    title: str | None = None,
    model: str | None = None,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Send several tasks about the same state in one request; the results come back by task name.

    `about` is a label per task name, kept in `meta` and never sent.
    """
    full, questions = request_all(tasks, state=state)
    _check(full, questions, warnings)
    meta = _with_meta(meta, about is not None, [(qid, (about or {}).get(qid.split("::")[0])) for qid in questions])
    answers = send(client, full, questions, log=log, title=title, model=model, meta=meta)
    out: dict[str, Any] = {}
    for name, task in tasks.items():
        prefix = f"{name}::"
        out[name] = task.read({qid[len(prefix):]: a for qid, a in answers.items() if qid.startswith(prefix)})
    return out


def _with_meta(meta: dict[str, Any] | None, has_about: bool, about: list[tuple[str, Any]]) -> dict[str, Any] | None:
    if not has_about:
        return meta
    out = dict(meta or {})
    for qid, a in about:
        if a is not None and qid not in out:
            out[qid] = a
    return out


def _check(state: Entry, questions: dict[str, Question], warnings: list[Problem] | None) -> None:
    problems = lint(state, questions)
    errors = [p for p in problems if p.level == "error"]
    if errors:
        raise LintError(errors)
    if warnings is not None:
        warnings.extend(p for p in problems if p.level == "warning")


@dataclass
class Placed:
    parts: dict[str, Json]
    ref: Callable[[At], Ref]


def place(text: Text, name: str) -> Placed:
    """Where a method's text lives: a Ref the caller already put in the state, or a new part of the task's own."""
    if isinstance(text, Ref):
        return Placed({}, lambda at: text)
    return Placed({name: text}, lambda at: at(name))


def nest(prefix: str, task: Task[T]) -> Task[T]:
    """Prefix a sub-task's question ids, for methods built from other methods."""
    return Task(
        parts=task.parts,
        questions=lambda at: {f"{prefix}.{qid}": qn for qid, qn in task.questions(at).items()},
        read=lambda answers: task.read({qid[len(prefix) + 1:]: a for qid, a in answers.items() if qid.startswith(f"{prefix}.")}),
    )
