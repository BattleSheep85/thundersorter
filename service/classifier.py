from google import genai
from google.genai import types

from service.config import Settings
from service.models import BatchTagResult, TagResult

SYSTEM_PROMPT = """\
You are an email classifier. Given an email's subject, sender, and body,
assign one or more tags from the allowed list. Return ONLY tags that clearly
apply. If nothing fits, return an empty list.

Allowed tags: {tags}

Rules:
- Be precise: only assign tags with high confidence.
- An email can have multiple tags (e.g., a shipping receipt is both "shipping" and "receipts").
- Newsletters and marketing emails should get "newsletters" or "promotions" as appropriate.
- Automated notifications (password resets, login alerts, CI builds) get "notifications".
"""

BATCH_SYSTEM_PROMPT = """\
You are an email classifier. You will receive multiple emails, each numbered.
For each email, assign one or more tags from the allowed list. Return ONLY tags
that clearly apply. If nothing fits for an email, return an empty list for it.

Return results in the same order as the input emails.

Allowed tags: {tags}

Rules:
- Be precise: only assign tags with high confidence.
- An email can have multiple tags (e.g., a shipping receipt is both "shipping" and "receipts").
- Newsletters and marketing emails should get "newsletters" or "promotions" as appropriate.
- Automated notifications (password resets, login alerts, CI builds) get "notifications".
"""


def _format_email(subject: str, sender: str, body: str) -> str:
    return f"Subject: {subject}\nFrom: {sender}\n\n{body[:4000]}"


class Classifier:
    def __init__(self, settings: Settings) -> None:
        self._client = genai.Client(api_key=settings.gemini_api_key)
        self._model = settings.gemini_model
        self._default_tags = settings.tags

    def _resolve_tags(self, custom_tags: list[str] | None) -> list[str]:
        return custom_tags if custom_tags else self._default_tags

    async def classify(
        self,
        subject: str,
        sender: str,
        body: str,
        tags: list[str] | None = None,
    ) -> list[str]:
        allowed = self._resolve_tags(tags)
        prompt = SYSTEM_PROMPT.format(tags=", ".join(allowed))

        response = await self._client.aio.models.generate_content(
            model=self._model,
            contents=_format_email(subject, sender, body),
            config=types.GenerateContentConfig(
                system_instruction=prompt,
                response_mime_type="application/json",
                response_schema=TagResult,
                temperature=0.1,
            ),
        )

        result = TagResult.model_validate_json(response.text)
        return [t for t in result.tags if t in allowed]

    async def classify_batch(
        self,
        emails: list[tuple[str, str, str]],
        tags: list[str] | None = None,
    ) -> list[list[str]]:
        allowed = self._resolve_tags(tags)
        prompt = BATCH_SYSTEM_PROMPT.format(tags=", ".join(allowed))

        numbered = "\n---\n".join(
            f"Email {i + 1}:\n{_format_email(subj, sender, body)}"
            for i, (subj, sender, body) in enumerate(emails)
        )

        response = await self._client.aio.models.generate_content(
            model=self._model,
            contents=numbered,
            config=types.GenerateContentConfig(
                system_instruction=prompt,
                response_mime_type="application/json",
                response_schema=BatchTagResult,
                temperature=0.1,
            ),
        )

        batch_result = BatchTagResult.model_validate_json(response.text)
        return [
            [t for t in r.tags if t in allowed]
            for r in batch_result.results
        ]
