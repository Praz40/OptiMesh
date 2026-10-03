FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.12.22 /uv /uvx /bin/
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY services/api/pyproject.toml services/api/uv.lock ./
RUN uv sync --frozen --no-dev
COPY services/api/app ./app
COPY services/api/alembic ./alembic
COPY services/api/alembic.ini ./
USER 65532:65532
EXPOSE 8000
CMD ["/app/.venv/bin/uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
