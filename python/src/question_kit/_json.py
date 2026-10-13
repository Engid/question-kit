"""JSON exactly as JavaScript's `JSON.stringify` writes it.

The TypeScript package keys its answer cache on `JSON.stringify` of the request, and splits big
requests by the length of that string. Writing the same bytes here means a request built in Python
gets the same cache key, so both languages can share one cache (and one set of recorded answers).

The differences from `json.dumps` are numbers (JavaScript writes `1.0` as `1`, `1e-05` as `0.00001`,
and `1e-07` as `1e-7`) and length, which JavaScript counts in UTF-16 code units.
"""

from __future__ import annotations

import json
import math
from typing import Any


def _number(x: float) -> str:
    """A number the way JavaScript's Number.prototype.toString writes it."""
    if math.isnan(x) or math.isinf(x):
        return "null"  # JSON.stringify writes NaN and Infinity as null
    if x == 0:
        return "0"  # including -0
    sign = "-" if x < 0 else ""
    # repr gives the shortest digits that round-trip, as JavaScript does; only the layout differs.
    mantissa, _, exp = repr(abs(x)).partition("e")
    int_part, _, frac_part = mantissa.partition(".")
    digits = (int_part + frac_part).lstrip("0")
    # n: where the decimal point goes, counted from the left of `digits` (JavaScript's spec name).
    n = len(int_part.lstrip("0")) if int_part.lstrip("0") else -(len(frac_part) - len(frac_part.lstrip("0")))
    n += int(exp) if exp else 0
    digits = digits.rstrip("0") or "0"
    k = len(digits)
    if k <= n <= 21:
        out = digits + "0" * (n - k)
    elif 0 < n <= 21:
        out = digits[:n] + "." + digits[n:]
    elif -6 < n <= 0:
        out = "0." + "0" * (-n) + digits
    else:
        e = n - 1
        out = digits[0] + ("." + digits[1:] if k > 1 else "") + "e" + ("+" if e > 0 else "-") + str(abs(e))
    return sign + out


def stringify(value: Any) -> str:
    """`JSON.stringify(value)`: no spaces, keys in insertion order, numbers written JavaScript's way."""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return _number(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(stringify(v) for v in value) + "]"
    if isinstance(value, dict):
        return "{" + ",".join(json.dumps(str(k), ensure_ascii=False) + ":" + stringify(v) for k, v in value.items()) + "}"
    raise TypeError(f"can't write {type(value).__name__} as JSON")


def js_length(s: str) -> int:
    """`s.length` in JavaScript: UTF-16 code units, so a character outside the BMP counts twice."""
    return len(s.encode("utf-16-le")) // 2
