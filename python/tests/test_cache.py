"""The answer cache: record, replay, ids relabeled, and answers recorded by the TypeScript cache."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from question_kit import check, classify, fake_jev, run
from question_kit.cache import CacheMissError, cache_key, cached_jev

MESSAGE = 'Hi, order 4410982 was due "last Friday" and it still isn\'t here.\nCall me at (479) 555-0100 or email Ana.Diaz@Example.com 🙂'
TS_CACHE = Path(__file__).parent / "fixtures" / "ts-cache"


def test_record_then_replay(tmp_path):
    inner = fake_jev(lambda *_: "yes")
    rec = cached_jev(inner, tmp_path)
    assert run(rec, check("hi", "It's a greeting.")).value is True
    assert run(rec, check("hi", "It's a greeting.")).value is True
    assert (rec.stats.hits, rec.stats.misses) == (1, 1)
    assert len(inner.requests) == 1
    replay = cached_jev(None, tmp_path, mode="replay")
    assert run(replay, check("hi", "It's a greeting.")).value is True
    with pytest.raises(CacheMissError):
        run(replay, check("hi", "It's a farewell."))


def test_ids_are_not_part_of_the_key(tmp_path):
    a = {"state": "x", "questions": {"one": {"type": "noul", "instructions": "Is `x` short?"}}}
    b = {"state": "x", "questions": {"two": {"type": "noul", "instructions": "Is `x` short?"}}}
    assert cache_key(a) == cache_key(b)
    rec = cached_jev(fake_jev(lambda *_: 0.8), tmp_path)
    rec.system_one(a)
    got = cached_jev(None, tmp_path, mode="replay").system_one(b)
    assert got["answers"] == {"two": {"type": "noul", "noul": 0.8}}


def test_the_entry_file_matches_the_typescript_layout(tmp_path):
    rec = cached_jev(fake_jev(lambda *_: 0.8), tmp_path)
    req = {"state": "x", "questions": {"q": {"type": "noul", "instructions": "Is `x` short?"}}}
    rec.system_one(req)
    key = cache_key(req)
    entry = json.loads((tmp_path / key[:2] / f"{key}.json").read_text(encoding="utf-8"))
    assert list(entry) == ["key", "recordedAt", "ms", "request", "response"]
    assert entry["key"] == key


def test_replays_an_answer_recorded_by_the_typescript_cache(tmp_path):
    shutil.copytree(TS_CACHE, tmp_path / "jev")
    replay = cached_jev(None, tmp_path / "jev", mode="replay")
    r = run(replay, classify(MESSAGE, {"shipping": "Where an order is", "refund": "Money back for an order"}))
    assert r.value == "shipping"
    assert r.probability == 0.93
    assert replay.stats.hits == 1
