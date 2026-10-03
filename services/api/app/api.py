"""Versioned REST and WebSocket routes for sites, devices, telemetry and commands.

No authentication yet (tracked as a P0 issue): any client reaching the API can
read every site and send commands. Do not expose it publicly before that lands.
"""

import asyncio
import contextlib
import logging
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Body, HTTPException, Query, Request, WebSocket, WebSocketDisconnect

from app.platform import DatabaseUnavailable, InvalidRequest, NotFound, Platform
from app.schemas import CommandOut, CommandRequest, SiteOut, SiteSnapshot, Telemetry

logger = logging.getLogger(__name__)

# Clients get a fresh snapshot at least this often, so devices going stale show up.
SNAPSHOT_REFRESH_S = 5.0

router = APIRouter(prefix="/api/v1")


def _platform(request: Request) -> Platform:
    platform: Platform = request.app.state.platform
    return platform


def _http_error(error: Exception) -> HTTPException:
    if isinstance(error, DatabaseUnavailable):
        return HTTPException(status_code=503, detail="Database unavailable")
    if isinstance(error, NotFound):
        return HTTPException(status_code=404, detail=str(error))
    if isinstance(error, InvalidRequest):
        return HTTPException(status_code=422, detail=str(error))
    return HTTPException(status_code=500, detail="Internal error")


@router.get("/sites")
def list_sites(request: Request) -> list[SiteOut]:
    try:
        return _platform(request).list_sites()
    except (DatabaseUnavailable, NotFound) as error:
        raise _http_error(error) from None


@router.get("/sites/{site_id}")
def get_site(request: Request, site_id: UUID) -> SiteSnapshot:
    try:
        return _platform(request).snapshot(site_id)
    except (DatabaseUnavailable, NotFound) as error:
        raise _http_error(error) from None


@router.get("/sites/{site_id}/devices/{device_id}/measurements")
def list_measurements(
    request: Request,
    site_id: UUID,
    device_id: UUID,
    limit: Annotated[int, Query(ge=1, le=1000)] = 100,
) -> list[dict[str, Any]]:
    try:
        return _platform(request).measurements(site_id, device_id, limit)
    except (DatabaseUnavailable, NotFound) as error:
        raise _http_error(error) from None


@router.post("/telemetry", status_code=202)
async def post_telemetry(request: Request, telemetry: Telemetry) -> dict[str, bool]:
    """HTTP alternative to MQTT telemetry, same payload. Idempotent per message_id."""
    try:
        stored = await _platform(request).ingest_telemetry(telemetry)
    except (DatabaseUnavailable, NotFound, InvalidRequest) as error:
        raise _http_error(error) from None
    return {"stored": stored}


@router.post("/sites/{site_id}/devices/{device_id}/commands", status_code=202)
async def send_command(
    request: Request,
    site_id: UUID,
    device_id: UUID,
    command: Annotated[CommandRequest, Body()],
) -> CommandOut:
    """Queue a command. 202 means accepted, not applied: watch its status."""
    try:
        return await _platform(request).send_command(site_id, device_id, command)
    except (DatabaseUnavailable, NotFound, InvalidRequest) as error:
        raise _http_error(error) from None


@router.get("/sites/{site_id}/commands")
def list_commands(
    request: Request,
    site_id: UUID,
    limit: Annotated[int, Query(ge=1, le=200)] = 20,
) -> list[CommandOut]:
    try:
        return _platform(request).list_commands(site_id, limit)
    except (DatabaseUnavailable, NotFound) as error:
        raise _http_error(error) from None


@router.get("/sites/{site_id}/commands/{command_id}")
def get_command(request: Request, site_id: UUID, command_id: UUID) -> CommandOut:
    try:
        return _platform(request).get_command(site_id, command_id)
    except (DatabaseUnavailable, NotFound) as error:
        raise _http_error(error) from None


@router.websocket("/sites/{site_id}/live")
async def live(websocket: WebSocket, site_id: UUID) -> None:
    """Streams {"type": "snapshot" | "command", "data": ...} events for one site."""
    platform: Platform = websocket.app.state.platform
    # Accept first: closing before accept becomes an HTTP 403 and browsers never see the code.
    await websocket.accept()
    try:
        snapshot = await asyncio.to_thread(platform.snapshot, site_id)
    except NotFound:
        await websocket.close(code=4404, reason="Site not found")
        return
    except DatabaseUnavailable:
        await websocket.close(code=1013, reason="Database unavailable")
        return
    async with platform.hub.subscribe(site_id) as queue:
        receiver = asyncio.create_task(_drain(websocket))
        try:
            initial = {"type": "snapshot", "data": snapshot.model_dump(mode="json")}
            await websocket.send_json(initial)
            while not receiver.done():
                try:
                    event = await asyncio.wait_for(queue.get(), SNAPSHOT_REFRESH_S)
                except TimeoutError:
                    fresh = await asyncio.to_thread(platform.snapshot, site_id)
                    event = {"type": "snapshot", "data": fresh.model_dump(mode="json")}
                if event is None:
                    await websocket.close(code=1013, reason="Client too slow")
                    return
                await websocket.send_json(event)
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            receiver.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await receiver


async def _drain(websocket: WebSocket) -> None:
    """Consume client frames so disconnects are noticed promptly."""
    with contextlib.suppress(WebSocketDisconnect, RuntimeError):
        while True:
            await websocket.receive_text()
