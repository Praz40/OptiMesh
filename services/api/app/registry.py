"""Authenticated /sites routes: provisioning, the caller's own sites and devices, and history.

Live snapshots and commands are served by /api/v1, which does not check tokens yet (issue #3).
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import Principal, PrincipalDep
from app.dependencies import SessionDep
from app.history import read_history
from app.models import Device, Site
from app.platform import Platform
from app.registry_schemas import (
    DeviceCreate,
    DeviceRead,
    HistoryPage,
    HistoryQuery,
    SiteCreate,
    SiteRead,
)

router = APIRouter(
    prefix="/sites",
    tags=["Registry"],
    responses={
        401: {"description": "Authentication required"},
        404: {"description": "Resource not found or inaccessible"},
        503: {"description": "Service unavailable"},
    },
)


def owned_site(session: Session, principal: Principal, site_id: UUID) -> Site:
    site = session.scalar(
        select(Site).where(Site.id == site_id, Site.owner_id == principal.user_id)
    )
    if site is None:
        raise HTTPException(status_code=404, detail="Site not found")
    return site


def owned_device(session: Session, principal: Principal, site_id: UUID, device_id: UUID) -> Device:
    device = session.scalar(
        select(Device)
        .join(Site, Device.site_id == Site.id)
        .where(
            Site.owner_id == principal.user_id, Device.site_id == site_id, Device.id == device_id
        )
    )
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    return device


@router.get("", response_model=list[SiteRead])
def list_own_sites(principal: PrincipalDep, session: SessionDep) -> list[SiteRead]:
    sites = session.scalars(
        select(Site)
        .where(Site.owner_id == principal.user_id)
        .order_by(Site.created_at.desc(), Site.id)
    ).all()
    return [SiteRead.model_validate(site) for site in sites]


@router.post("", response_model=SiteRead, status_code=201)
def create_site(payload: SiteCreate, principal: PrincipalDep, session: SessionDep) -> SiteRead:
    site = Site(owner_id=principal.user_id, **payload.model_dump())
    session.add(site)
    session.flush()
    result = SiteRead.model_validate(site)
    session.commit()
    return result


@router.post(
    "/{site_id}/devices",
    response_model=DeviceRead,
    status_code=201,
    response_model_exclude_none=True,
)
def create_device(
    site_id: UUID,
    payload: DeviceCreate,
    request: Request,
    principal: PrincipalDep,
    session: SessionDep,
) -> DeviceRead:
    owned_site(session, principal, site_id)
    device = Device(
        site_id=site_id,
        name=payload.name,
        kind=payload.kind.value,
        source=payload.source,
        capabilities=[capability.value for capability in payload.capabilities],
        limits=payload.limits.model_dump(exclude_none=True),
    )
    session.add(device)
    session.flush()
    result = DeviceRead.model_validate(device)
    session.commit()
    # After the commit: earlier, a concurrent snapshot could cache the old list again.
    platform: Platform = request.app.state.platform
    platform.forget_site_devices(site_id)
    return result


@router.get(
    "/{site_id}/devices",
    response_model=list[DeviceRead],
    response_model_exclude_none=True,
)
def list_devices(site_id: UUID, principal: PrincipalDep, session: SessionDep) -> list[DeviceRead]:
    owned_site(session, principal, site_id)
    devices = session.scalars(
        select(Device).where(Device.site_id == site_id).order_by(Device.name, Device.id)
    ).all()
    return [DeviceRead.model_validate(device) for device in devices]


@router.get("/{site_id}/measurements", response_model=HistoryPage, tags=["History"])
def get_history(
    site_id: UUID,
    query: Annotated[HistoryQuery, Query()],
    principal: PrincipalDep,
    session: SessionDep,
) -> HistoryPage:
    owned_site(session, principal, site_id)
    if query.device_id is not None:
        owned_device(session, principal, site_id, query.device_id)
    return read_history(session, principal, site_id, query)
