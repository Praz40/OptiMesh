import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.api import router
from app.auth import JwtVerifier
from app.config import Settings
from app.database import build_engine
from app.mqtt import MqttBridge
from app.platform import Platform
from app.registry import router as registry_router

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    config = settings if settings is not None else Settings()
    engine = build_engine(config.database_url.get_secret_value()) if config.database_url else None
    platform = Platform(
        engine,
        stale_after_s=config.device_stale_after_s,
        command_ttl_s=config.command_ttl_s,
    )
    bridge = MqttBridge(config, platform) if config.mqtt_host else None
    platform.publisher = bridge

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        tasks = []
        if engine is not None:
            tasks.append(asyncio.create_task(platform.run_maintenance()))
        if bridge is not None:
            tasks.append(asyncio.create_task(bridge.run()))
        try:
            yield
        finally:
            for task in tasks:
                task.cancel()
            for task in tasks:
                with contextlib.suppress(asyncio.CancelledError):
                    await task
            if engine is not None:
                engine.dispose()

    application = FastAPI(title="OptiMesh API", version="0.2.0", lifespan=lifespan)
    application.state.platform = platform
    # The authenticated /sites routes use these; /api/v1 does not check tokens yet (issue #3).
    application.state.engine = engine
    application.state.token_verifier = (
        JwtVerifier(str(config.supabase_url)) if config.supabase_url else None
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "Authorization"],
    )
    application.include_router(router)
    application.include_router(registry_router)

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

    @application.get("/status")
    @application.get("/api/v1/status")
    def status() -> dict[str, str]:
        """Pipeline status for the dashboard; MQTT is 'disabled' when not configured."""
        if bridge is None:
            mqtt = "disabled"
        else:
            mqtt = "connected" if bridge.connected else "disconnected"
        return {"mqtt": mqtt}

    return application


app = create_app()
