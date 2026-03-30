from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    gemini_api_key: str
    gemini_model: str = "gemini-2.5-flash"
    host: str = "127.0.0.1"
    port: int = 8465
    tags: list[str] = [
        "finance",
        "receipts",
        "newsletters",
        "social",
        "work",
        "personal",
        "notifications",
        "shipping",
        "travel",
        "promotions",
    ]

    model_config = {"env_file": ".env", "env_prefix": "THUNDERSORTER_", "env_nested_delimiter": "__"}


def load_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
