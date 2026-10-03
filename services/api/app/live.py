"""In-memory live state and per-site event fan-out for WebSocket clients.

Single-process by design for the MVP. Persistent history lives in PostgreSQL;
this only holds the latest reading per device.
"""

import asyncio
import logging
from collections import defaultdict
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from app.schemas import DeviceLive, Telemetry

logger = logging.getLogger(__name__)

Event = dict[str, Any]


def utc_now() -> datetime:
    return datetime.now(UTC)


@dataclass(frozen=True)
class LatestReading:
    telemetry: Telemetry
    received_at: datetime


class LiveState:
    def __init__(self, stale_after_s: float, clock: Callable[[], datetime] = utc_now) -> None:
        self._stale_after = timedelta(seconds=stale_after_s)
        self._clock = clock
        self._latest: dict[UUID, LatestReading] = {}

    def record(self, telemetry: Telemetry, received_at: datetime) -> bool:
        """Keep the newest reading per device; out-of-order messages are ignored."""
        current = self._latest.get(telemetry.device_id)
        if current is not None and telemetry.observed_at < current.telemetry.observed_at:
            return False
        self._latest[telemetry.device_id] = LatestReading(telemetry, received_at)
        return True

    def device(self, device_id: UUID) -> DeviceLive:
        latest = self._latest.get(device_id)
        if latest is None:
            return DeviceLive(
                device_id=device_id,
                online=False,
                observed_at=None,
                received_at=None,
                metrics=None,
                state=None,
            )
        return DeviceLive(
            device_id=device_id,
            # Online is judged by our clock, so a device with a wrong clock still shows online.
            online=self._clock() - latest.received_at <= self._stale_after,
            observed_at=latest.telemetry.observed_at,
            received_at=latest.received_at,
            metrics=latest.telemetry.metrics,
            state=latest.telemetry.state,
        )


class EventHub:
    """Fan-out of site events to subscribers. Slow subscribers are disconnected."""

    def __init__(self, queue_size: int = 100) -> None:
        self._queue_size = queue_size
        self._subscribers: defaultdict[UUID, set[asyncio.Queue[Event | None]]] = defaultdict(set)

    def has_subscribers(self, site_id: UUID) -> bool:
        return bool(self._subscribers.get(site_id))

    @asynccontextmanager
    async def subscribe(self, site_id: UUID) -> AsyncIterator[asyncio.Queue[Event | None]]:
        queue: asyncio.Queue[Event | None] = asyncio.Queue(self._queue_size)
        self._subscribers[site_id].add(queue)
        try:
            yield queue
        finally:
            self._subscribers[site_id].discard(queue)
            if not self._subscribers[site_id]:
                del self._subscribers[site_id]

    def publish(self, site_id: UUID, event: Event) -> None:
        for queue in list(self._subscribers.get(site_id, ())):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                logger.warning("Dropping slow live subscriber for site %s", site_id)
                self._subscribers[site_id].discard(queue)
                # Make room for the sentinel so the consumer sees it and closes.
                queue.get_nowait()
                queue.put_nowait(None)
