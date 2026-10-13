"""An answer cache: wrap any client so each distinct request is sent once and its answers are kept on disk.

    from question_kit.cache import cached_jev
    client = cached_jev(typesafe_jev(), ".cache/jev")               # record: call on a miss, then save
    client = cached_jev(None, ".cache/jev", mode="replay")          # replay: a miss raises, never calls

A request's key is the SHA-256 of what Jev sees: its model, state and question bodies in the order
they're sent; question ids and `meta` are not part of it. The key and the files are the same as the
TypeScript package's (`question-kit/cache`), so the two can share a cache folder: each answer is a
JSON file at `<dir>/<first two hex digits>/<key>.json` holding the request and the response.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, Optional

from question_kit._json import stringify
from question_kit.system_one import SystemOneClient, SystemOneRequest, SystemOneResponse

CacheMode = Literal["record", "replay"]


class CacheMissError(Exception):
    """A request with no cached answer, in replay mode."""

    def __init__(self, key: str) -> None:
        self.key = key
        super().__init__(f"no cached answer for request {key[:12]}… (record it first)")


def cache_key(request: SystemOneRequest) -> str:
    """The cache key of a request: its model, state and question bodies in order; ids left out."""
    body = stringify({"model": request.get("model"), "state": request["state"], "questions": list(request["questions"].values())})
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def relabel(entry: dict[str, Any], request: SystemOneRequest) -> SystemOneResponse:
    """A cached response with its answers under `request`'s ids (the questions are in the same order)."""
    old = list(entry["request"]["questions"])
    new = list(request["questions"])
    if old == new:
        return entry["response"]
    answers = {}
    for i, qid in enumerate(new):
        a = entry["response"]["answers"].get(old[i]) if i < len(old) else None
        if a is not None:
            answers[qid] = a
    return {**entry["response"], "answers": answers}


@dataclass
class CacheStats:
    hits: int = 0
    misses: int = 0


@dataclass
class CachedJev:
    """A client that answers from a cache folder. See `cached_jev`."""

    client: Optional[SystemOneClient]
    dir: Path
    mode: CacheMode = "record"
    stats: CacheStats = field(default_factory=CacheStats)

    def system_one(self, request: SystemOneRequest) -> SystemOneResponse:
        key = cache_key(request)
        path = self.dir / key[:2] / f"{key}.json"
        try:
            entry = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            entry = None
        if entry is not None:
            self.stats.hits += 1
            return relabel(entry, request)
        self.stats.misses += 1
        if self.mode == "replay" or self.client is None:
            raise CacheMissError(key)
        t0 = time.perf_counter()
        response = self.client.system_one(request)
        recorded = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        entry = {"key": key, "recordedAt": recorded, "ms": round((time.perf_counter() - t0) * 1000), "request": request, "response": response}
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(f".{os.getpid()}.tmp")
        tmp.write_text(stringify(entry), encoding="utf-8")
        os.replace(tmp, path)
        return response


def cached_jev(client: Optional[SystemOneClient], dir: str | os.PathLike[str], *, mode: CacheMode = "record") -> CachedJev:
    """Wrap a client with an answer cache in `dir`. "record" calls the client on a miss; "replay" raises `CacheMissError`."""
    if mode == "record" and client is None:
        raise ValueError('cached_jev: "record" mode needs a client to call on a miss')
    return CachedJev(client, Path(dir), mode)
