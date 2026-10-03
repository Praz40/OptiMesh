import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.auth import JwtVerifier
from app.config import Settings
from app.database import build_engine
from app.registry import router

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    config = settings if settings is not None else Settings()
    engine = build_engine(config.database_url.get_secret_value()) if config.database_url else None

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        try:
            yield
        finally:
            if engine is not None:
                engine.dispose()

    application = FastAPI(title="OptiMesh API", version="0.1.0", lifespan=lifespan)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "Authorization"],
    )

    application.state.engine = engine
    application.state.token_verifier = (
        JwtVerifier(str(config.supabase_url)) if config.supabase_url else None
    )
    application.include_router(router)

    @application.exception_handler(SQLAlchemyError)
    async def database_error(_: Request, _error: SQLAlchemyError) -> JSONResponse:
        logger.warning("Database request failed")
        return JSONResponse(status_code=503, content={"detail": "Database unavailable"})

    @application.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "optimesh-api"}

    @application.get("/ready")
    def readiness() -> dict[str, str]:
        if engine is None:
            raise HTTPException(status_code=503, detail="Database unavailable")
        try:
            with engine.connect() as connection:
                connection.execute(text("SELECT 1"))
        except SQLAlchemyError:
            logger.warning("Database readiness check failed")
            raise HTTPException(status_code=503, detail="Database unavailable") from None
        return {"status": "ready"}

    return application


app = create_app()
