from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from service.classifier import Classifier, _format_email
from service.config import Settings


def _make_settings(**overrides) -> Settings:
    defaults = {
        "gemini_api_key": "test-key",
        "gemini_model": "gemini-2.5-flash",
        "host": "127.0.0.1",
        "port": 8465,
        "tags": ["finance", "receipts", "newsletters", "social"],
    }
    defaults.update(overrides)
    return Settings(**defaults)


@pytest.mark.unit
def test_format_email() -> None:
    result = _format_email("Test Subject", "sender@example.com", "Hello world")
    assert "Subject: Test Subject" in result
    assert "From: sender@example.com" in result
    assert "Hello world" in result


@pytest.mark.unit
def test_format_email_truncates_body() -> None:
    long_body = "x" * 5000
    result = _format_email("Sub", "s@e.com", long_body)
    body_part = result.split("\n\n", 1)[1]
    assert len(body_part) == 4000


@pytest.mark.unit
def test_resolve_tags_uses_custom() -> None:
    with patch("service.classifier.genai"):
        classifier = Classifier(_make_settings())
    custom = ["alerts", "billing"]
    assert classifier._resolve_tags(custom) == ["alerts", "billing"]


@pytest.mark.unit
def test_resolve_tags_uses_defaults() -> None:
    with patch("service.classifier.genai"):
        classifier = Classifier(_make_settings())
    assert classifier._resolve_tags(None) == ["finance", "receipts", "newsletters", "social"]


@pytest.mark.unit
async def test_classify_filters_invalid_tags() -> None:
    with patch("service.classifier.genai") as mock_genai:
        mock_response = MagicMock()
        mock_response.text = '{"tags": ["finance", "invalid_tag", "receipts"]}'
        mock_genai.Client.return_value.aio.models.generate_content = AsyncMock(
            return_value=mock_response
        )

        classifier = Classifier(_make_settings())
        result = await classifier.classify("Test", "a@b.com", "body")

    assert result == ["finance", "receipts"]
    assert "invalid_tag" not in result


@pytest.mark.unit
async def test_classify_with_custom_tags() -> None:
    with patch("service.classifier.genai") as mock_genai:
        mock_response = MagicMock()
        mock_response.text = '{"tags": ["alerts"]}'
        mock_genai.Client.return_value.aio.models.generate_content = AsyncMock(
            return_value=mock_response
        )

        classifier = Classifier(_make_settings())
        result = await classifier.classify("Test", "a@b.com", "body", tags=["alerts", "billing"])

    assert result == ["alerts"]


@pytest.mark.unit
async def test_classify_batch() -> None:
    with patch("service.classifier.genai") as mock_genai:
        mock_response = MagicMock()
        mock_response.text = '{"results": [{"tags": ["finance"]}, {"tags": ["newsletters"]}]}'
        mock_genai.Client.return_value.aio.models.generate_content = AsyncMock(
            return_value=mock_response
        )

        classifier = Classifier(_make_settings())
        result = await classifier.classify_batch([
            ("Invoice", "a@b.com", "Pay"),
            ("Digest", "news@x.com", "Weekly"),
        ])

    assert result == [["finance"], ["newsletters"]]


@pytest.mark.unit
async def test_classify_batch_filters_invalid() -> None:
    with patch("service.classifier.genai") as mock_genai:
        mock_response = MagicMock()
        mock_response.text = '{"results": [{"tags": ["finance", "bogus"]}]}'
        mock_genai.Client.return_value.aio.models.generate_content = AsyncMock(
            return_value=mock_response
        )

        classifier = Classifier(_make_settings())
        result = await classifier.classify_batch([("Sub", "a@b.com", "body")])

    assert result == [["finance"]]
