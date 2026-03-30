from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

import service.main as main_module
from service.classifier import Classifier
from service.config import Settings
from service.main import app


def _test_settings() -> Settings:
    return Settings(
        gemini_api_key="test-key",
        gemini_model="gemini-2.5-flash",
        host="127.0.0.1",
        port=8465,
        tags=["finance", "receipts", "newsletters"],
    )


@pytest.fixture
async def client():
    settings = _test_settings()
    with patch("service.classifier.genai"):
        classifier = Classifier(settings)

    main_module._settings = settings
    main_module._classifier = classifier
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as ac:
            yield ac
    finally:
        main_module._settings = None
        main_module._classifier = None


@pytest.mark.integration
async def test_health(client: AsyncClient) -> None:
    response = await client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "finance" in data["available_tags"]


@pytest.mark.integration
async def test_classify(client: AsyncClient) -> None:
    with patch("service.classifier.Classifier.classify", new_callable=AsyncMock) as mock:
        mock.return_value = ["finance", "receipts"]
        response = await client.post("/classify", json={
            "subject": "Your invoice #1234",
            "sender": "billing@example.com",
            "body": "Please find attached your invoice.",
            "message_id": "msg-1",
        })

    assert response.status_code == 200
    data = response.json()
    assert data["message_id"] == "msg-1"
    assert data["tags"] == ["finance", "receipts"]


@pytest.mark.integration
async def test_classify_with_custom_tags(client: AsyncClient) -> None:
    with patch("service.classifier.Classifier.classify", new_callable=AsyncMock) as mock:
        mock.return_value = ["invoices"]
        response = await client.post("/classify", json={
            "subject": "Invoice",
            "sender": "a@b.com",
            "body": "Invoice attached",
            "tags": ["invoices", "alerts"],
        })

    assert response.status_code == 200
    mock.assert_called_once()
    call_kwargs = mock.call_args
    assert call_kwargs.kwargs.get("tags") == ["invoices", "alerts"]


@pytest.mark.integration
async def test_classify_batch(client: AsyncClient) -> None:
    with patch("service.classifier.Classifier.classify_batch", new_callable=AsyncMock) as mock:
        mock.return_value = [["finance"], ["newsletters"]]
        response = await client.post("/classify-batch", json={
            "emails": [
                {"subject": "Invoice", "sender": "a@b.com", "body": "Pay up", "message_id": "1"},
                {"subject": "Weekly digest", "sender": "news@x.com", "body": "This week...", "message_id": "2"},
            ],
        })

    assert response.status_code == 200
    data = response.json()
    assert len(data["results"]) == 2
    assert data["results"][0]["tags"] == ["finance"]
    assert data["results"][1]["tags"] == ["newsletters"]


@pytest.mark.integration
async def test_classify_batch_max_10(client: AsyncClient) -> None:
    emails = [
        {"subject": f"Email {i}", "sender": "a@b.com", "body": "body"}
        for i in range(11)
    ]
    response = await client.post("/classify-batch", json={"emails": emails})
    assert response.status_code == 422


@pytest.mark.integration
async def test_cors_headers(client: AsyncClient) -> None:
    response = await client.options(
        "/health",
        headers={
            "Origin": "moz-extension://abc123",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.status_code == 200
    assert "access-control-allow-origin" in response.headers
