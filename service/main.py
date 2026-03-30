import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from service.classifier import Classifier
from service.config import Settings, load_settings
from service.models import (
    BatchClassifyResponse,
    BatchEmailPayload,
    ClassifyResponse,
    EmailPayload,
    HealthResponse,
)

logger = logging.getLogger("thundersorter")

_classifier: Classifier | None = None
_settings: Settings | None = None


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    global _classifier, _settings
    _settings = load_settings()
    _classifier = Classifier(_settings)
    logger.info("Thundersorter service ready on %s:%d", _settings.host, _settings.port)
    yield
    _classifier = None
    _settings = None


app = FastAPI(title="Thundersorter", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    assert _settings is not None
    return HealthResponse(status="ok", available_tags=_settings.tags)


@app.post("/classify", response_model=ClassifyResponse)
async def classify(payload: EmailPayload) -> ClassifyResponse:
    if _classifier is None:
        raise HTTPException(status_code=503, detail="Classifier not initialized")

    tags = await _classifier.classify(
        subject=payload.subject,
        sender=payload.sender,
        body=payload.body,
        tags=payload.tags,
    )
    return ClassifyResponse(message_id=payload.message_id, tags=tags)


@app.post("/classify-batch", response_model=BatchClassifyResponse)
async def classify_batch(payload: BatchEmailPayload) -> BatchClassifyResponse:
    if _classifier is None:
        raise HTTPException(status_code=503, detail="Classifier not initialized")

    per_request_tags = payload.tags
    emails = [
        (e.subject, e.sender, e.body)
        for e in payload.emails
    ]
    tag_lists = await _classifier.classify_batch(emails, tags=per_request_tags)

    results = [
        ClassifyResponse(message_id=e.message_id, tags=tag_list)
        for e, tag_list in zip(payload.emails, tag_lists)
    ]
    return BatchClassifyResponse(results=results)


def main() -> None:
    import uvicorn

    settings = load_settings()
    uvicorn.run(
        "service.main:app",
        host=settings.host,
        port=settings.port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
