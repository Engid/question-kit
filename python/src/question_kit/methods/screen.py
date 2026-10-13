"""screen: check a message against a set of flags, and decide what to do.

One request: one Noul per flag (phrased so that yes means the flag applies) and, optionally, a
severity Score. Each flag names an action; code applies thresholds you set (a policy) and a
precedence among actions. Jev gives the evidence; your code makes the decision.
Based on the approach in TypeSafe's "Guardrails for LLMs" cookbook.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from question_kit.questions import noul, score, yes_no_criteria
from question_kit.readings import read_noul, read_score
from question_kit.state import Text
from question_kit.task import Task, place

POLICIES: dict[str, dict[str, float]] = {
    "strict": {"act": 0.7, "review": 0.35},
    "permissive": {"act": 0.85, "review": 0.35},
}
"""Take a flag's action at or above `act`; below that but at or above `review`, the action is "review"."""


@dataclass
class Triggered:
    flag: str
    probability: float
    action: str


@dataclass
class Screened:
    action: str
    """The most serious triggered action, "review", or "pass"."""
    triggered: list[Triggered] = field(default_factory=list)
    """Flags at or above the review threshold, most likely first."""
    flags: dict[str, float] = field(default_factory=dict)
    """Every flag's probability."""
    severity: Optional[float] = None


def screen(
    text: Text,
    flags: dict[str, dict],
    *,
    precedence: list[str],
    policy: Optional[dict[str, float]] = None,
    severity: Optional[dict] = None,
    name: str = "message",
) -> Task[Screened]:
    """Which flags does the text raise, and what should happen?

    Each flag is `{"statement": ..., "action": ...}` (plus optional `"true"`/`"false"` descriptions).
    `precedence` lists actions from most to least serious. `policy` is `{"act", "review"}` and
    optionally `"escalate_at_severity"`, used with `severity={"question": ..., "levels": [...]}`.
    """
    t = place(text, name)
    pol = policy or POLICIES["strict"]

    def questions(at):  # type: ignore[no-untyped-def]
        r = t.ref(at)
        qs = {fid: noul(f"About {r}: {f['statement']}", yes_no_criteria(f.get("true"), f.get("false"))) for fid, f in flags.items()}
        if severity:
            qs["__severity"] = score(f"About {r}: {severity['question']}", severity["levels"])
        return qs

    def read(a):  # type: ignore[no-untyped-def]
        probs = {fid: read_noul(a.get(fid)).probability for fid in flags}
        sev = read_score(a.get("__severity")).value if severity else None
        triggered: list[Triggered] = []
        for fid, f in flags.items():
            p = probs[fid]
            if p >= pol["act"]:
                triggered.append(Triggered(fid, p, f["action"]))
            elif p >= pol["review"]:
                triggered.append(Triggered(fid, p, "review"))
        escalate = pol.get("escalate_at_severity")
        if sev is not None and escalate is not None and sev >= escalate:
            for tr in triggered:
                if tr.action == "review":
                    tr.action = precedence[0]
        triggered.sort(key=lambda tr: -tr.probability)
        order = [*precedence, "review", "pass"]
        action = "pass"
        for tr in triggered:
            if order.index(tr.action) < order.index(action):
                action = tr.action
        return Screened(action, triggered, probs, sev)

    return Task(parts=t.parts, questions=questions, read=read)

