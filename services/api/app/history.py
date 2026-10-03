import base64
import binascii
from uuid import UUID

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select, tuple_
from sqlalchemy.orm import Session

from app.auth import Principal
from app.models import Measurement, Site
from app.registry_schemas import HistoryCursor, HistoryPage, HistoryQuery, MeasurementRead


def decode_cursor(value: str, query: HistoryQuery, site_id: UUID, user_id: UUID) -> HistoryCursor:
    try:
        payload = base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)
        cursor = HistoryCursor.model_validate_json(payload)
        if (cursor.site_id, cursor.user_id, cursor.device_id, cursor.start, cursor.end) != (
            site_id,
            user_id,
            query.device_id,
            query.start,
            query.end,
        ) or not query.start <= cursor.observed_at < query.end:
            raise ValueError("Cursor does not match query")
        return cursor
    except (ValueError, ValidationError, binascii.Error):
        raise HTTPException(status_code=422, detail="Invalid history cursor") from None


def read_history(
    session: Session, principal: Principal, site_id: UUID, query: HistoryQuery
) -> HistoryPage:
    statement = (
        select(Measurement)
        .join(Site, Measurement.site_id == Site.id)
        .where(
            Site.owner_id == principal.user_id,
            Measurement.site_id == site_id,
            Measurement.observed_at >= query.start,
            Measurement.observed_at < query.end,
        )
    )
    if query.device_id is not None:
        statement = statement.where(Measurement.device_id == query.device_id)
    if query.cursor is not None:
        cursor = decode_cursor(query.cursor, query, site_id, principal.user_id)
        statement = statement.where(
            tuple_(Measurement.observed_at, Measurement.id) > tuple_(cursor.observed_at, cursor.id)
        )
    rows = list(
        session.scalars(
            statement.order_by(Measurement.observed_at, Measurement.id).limit(query.limit + 1)
        )
    )
    items = [MeasurementRead.model_validate(row) for row in rows[: query.limit]]
    next_cursor = None
    if len(rows) > query.limit:
        last = items[-1]
        payload = HistoryCursor(
            user_id=principal.user_id,
            site_id=site_id,
            device_id=query.device_id,
            start=query.start,
            end=query.end,
            observed_at=last.observed_at,
            id=last.id,
        ).model_dump_json()
        next_cursor = base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")
    return HistoryPage(items=items, next_cursor=next_cursor)
