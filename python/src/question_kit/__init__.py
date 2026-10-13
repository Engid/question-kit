"""question-kit: the standard library for System One models, starting with Jev.

Build good questions for a System One model, send them, and read the answers. This is an early
release of the Python port: the core plumbing and a first set of methods. The TypeScript package is
the full kit (https://docs.questionkit.dev).

    from question_kit import classify, run
    from question_kit.typesafe import typesafe_jev

    client = typesafe_jev()
    r = run(client, classify("where is my package?", {
        "shipping": "Where an order is, or when it will arrive",
        "refund": "Money back for an order",
    }))
    r.value, r.confidence
"""

from question_kit.lint import LintError, Problem, lint
from question_kit.methods import (
    PATTERNS,
    POLICIES,
    Classified,
    ExtractedValue,
    Label,
    ScoredItem,
    ScoreRanking,
    Screened,
    Triggered,
    above,
    classify,
    extract_value,
    find_candidates,
    rank_by_score,
    screen,
)
from question_kit.ops import Wording, about, check, checks, choose, rate
from question_kit.questions import NONE, Option, choice, describe_option, noul, score
from question_kit.readings import (
    ChoiceReading,
    NoulReading,
    ScoreReading,
    band,
    choice_confidence,
    decide,
    lowest,
    noul_confidence,
    read_choice,
    read_noul,
    read_score,
    score_confidence,
)
from question_kit.state import Ref, Text, keyed, paths, ref, referenced_paths
from question_kit.system_one import (
    CHARS_PER_TOKEN,
    MAX_CHOICE_OPTIONS,
    MAX_REQUEST_TOKENS,
    PRICE_PER_MILLION_INPUT,
    REQUEST_OVERHEAD_TOKENS,
    Answer,
    ChoiceQuestion,
    Entry,
    FakeJev,
    Json,
    NoulQuestion,
    Question,
    ScoreQuestion,
    SystemOneCall,
    SystemOneClient,
    SystemOneRequest,
    SystemOneResponse,
    estimate_cost,
    estimate_tokens,
    fake_jev,
    send,
)
from question_kit.task import Task, nest, place, request, request_all, run, run_all

__version__ = "0.1.0"

__all__ = [
    "CHARS_PER_TOKEN",
    "MAX_CHOICE_OPTIONS",
    "MAX_REQUEST_TOKENS",
    "NONE",
    "PATTERNS",
    "POLICIES",
    "PRICE_PER_MILLION_INPUT",
    "REQUEST_OVERHEAD_TOKENS",
    "Answer",
    "ChoiceQuestion",
    "ChoiceReading",
    "Classified",
    "Entry",
    "ExtractedValue",
    "FakeJev",
    "Json",
    "Label",
    "LintError",
    "NoulQuestion",
    "NoulReading",
    "Option",
    "Problem",
    "Question",
    "Ref",
    "ScoreQuestion",
    "ScoreRanking",
    "ScoreReading",
    "ScoredItem",
    "Screened",
    "SystemOneCall",
    "SystemOneClient",
    "SystemOneRequest",
    "SystemOneResponse",
    "Task",
    "Text",
    "Triggered",
    "Wording",
    "__version__",
    "about",
    "above",
    "band",
    "check",
    "checks",
    "choice",
    "choice_confidence",
    "choose",
    "classify",
    "decide",
    "describe_option",
    "estimate_cost",
    "estimate_tokens",
    "extract_value",
    "fake_jev",
    "find_candidates",
    "keyed",
    "lint",
    "lowest",
    "nest",
    "noul",
    "noul_confidence",
    "paths",
    "place",
    "rank_by_score",
    "rate",
    "read_choice",
    "read_noul",
    "read_score",
    "ref",
    "referenced_paths",
    "request",
    "request_all",
    "run",
    "run_all",
    "score",
    "score_confidence",
    "screen",
    "send",
]
