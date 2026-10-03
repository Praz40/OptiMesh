from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from app.auth import PrincipalDep


def get_session(request: Request, _principal: PrincipalDep) -> Iterator[Session]:
    engine: Engine | None = request.app.state.engine
    if engine is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    with Session(engine, expire_on_commit=False) as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]
