from pydantic import BaseModel, Field


class EmailPayload(BaseModel):
    subject: str
    sender: str
    body: str
    message_id: str | None = None
    tags: list[str] | None = None


class BatchEmailPayload(BaseModel):
    emails: list[EmailPayload] = Field(max_length=10)
    tags: list[str] | None = None


class TagResult(BaseModel):
    tags: list[str]


class BatchTagResult(BaseModel):
    results: list[TagResult]


class ClassifyResponse(BaseModel):
    message_id: str | None
    tags: list[str]


class BatchClassifyResponse(BaseModel):
    results: list[ClassifyResponse]


class HealthResponse(BaseModel):
    status: str
    available_tags: list[str]
