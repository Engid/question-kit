"""A client for TypeSafe's API, through their Python SDK (`typesafe-sdk`, installed with the `typesafe` extra).

    pip install "question-kit[typesafe]"

    from question_kit.typesafe import typesafe_jev
    client = typesafe_jev()   # reads TYPESAFE_API_KEY

The rest of question-kit only needs something with a `system_one(request)` method, so this module is
the only one that touches the SDK.
"""

from __future__ import annotations

import os
from typing import Any, Optional

from question_kit.system_one import SystemOneRequest, SystemOneResponse

DEFAULT_RETRY: dict[str, float] = {"max_retries": 5, "backoff_initial": 1.0, "backoff_max": 16.0}
"""Retries for HTTP 408, 429 and 5xx, timeouts and dropped connections: 5, waiting about 1, 2, 4, 8 and 16
seconds (each up to a quarter less, at random). The SDK's own default is 2 retries over about 1.5 seconds."""


class TypeSafeJev:
    """TypeSafe's SDK client behind the `system_one(request)` interface question-kit uses. See `typesafe_jev`."""

    def __init__(self, client: Any) -> None:
        self.client = client

    def system_one(self, request: SystemOneRequest) -> SystemOneResponse:
        # Only what the API takes: never `meta`.
        response = self.client.system_one(request["state"], request["questions"], model=request.get("model"))
        # Plain JSON, the way the API sends it (score levels keyed "0", "1", …), so readers, logs and the
        # cache see the same shape as the TypeScript package does.
        return response.model_dump(mode="json", exclude_none=True)

    def close(self) -> None:
        self.client.close()

    def __enter__(self) -> TypeSafeJev:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


def typesafe_jev(
    *,
    api_key: Optional[str] = None,
    model: Optional[str] = None,
    timeout: float = 60.0,
    retry: Optional[dict[str, Any]] = None,
    base_url: Optional[str] = None,
    **client_options: Any,
) -> TypeSafeJev:
    """A client for Jev through TypeSafe's SDK.

    `api_key` defaults to the TYPESAFE_API_KEY environment variable. `timeout` is per attempt, in
    seconds (60 by default; big requests can take longer than the SDK's 10). `retry` is merged over
    `DEFAULT_RETRY` (`{"max_retries": 0}` turns retries off). Other keyword arguments go to
    `typesafe_sdk.TypeSafeClient`.
    """
    try:
        from typesafe_sdk import RetryPolicy, TypeSafeClient
    except ImportError as e:  # pragma: no cover - depends on the environment
        raise ImportError('typesafe_jev needs TypeSafe\'s SDK: pip install "question-kit[typesafe]"') from e
    key = api_key or os.environ.get("TYPESAFE_API_KEY")
    if not key:
        raise ValueError("typesafe_jev: no API key (pass api_key or set TYPESAFE_API_KEY)")
    client = TypeSafeClient(
        api_key=key,
        model=model,
        timeout=timeout,
        retry=RetryPolicy(**{**DEFAULT_RETRY, **(retry or {})}),
        base_url=base_url,
        **client_options,
    )
    return TypeSafeJev(client)
