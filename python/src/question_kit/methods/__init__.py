"""The ready-made methods. Everything here is also exported from `question_kit`."""

from question_kit.methods.classify import Classified, Label, classify
from question_kit.methods.extract_value import PATTERNS, ExtractedValue, extract_value, find_candidates
from question_kit.methods.rank_by_score import ScoredItem, ScoreRanking, above, rank_by_score
from question_kit.methods.screen import POLICIES, Screened, Triggered, screen

__all__ = [
    "PATTERNS",
    "POLICIES",
    "Classified",
    "ExtractedValue",
    "Label",
    "ScoreRanking",
    "ScoredItem",
    "Screened",
    "Triggered",
    "above",
    "classify",
    "extract_value",
    "find_candidates",
    "rank_by_score",
    "screen",
]
