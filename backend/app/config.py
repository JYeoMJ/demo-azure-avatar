import os
import logging
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# Models known to support Voice Live (per Azure docs)
# See: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/regions?tabs=voice-live
VOICELIVE_COMPATIBLE_MODELS = [
    "gpt-4o-realtime-preview",
    "gpt-4o-realtime",
    "gpt-realtime-mini",
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-5.1",
    "gpt-5.1-chat",
    "gpt-5",
    "gpt-5-mini",
    "gpt-5-nano",
    "gpt-5-chat",
]


class Settings:
    # Azure VoiceLive
    VOICELIVE_ENDPOINT: str = os.getenv(
        "AZURE_VOICELIVE_ENDPOINT",
        "wss://eastus2.voice.speech.microsoft.com"
    )
    VOICELIVE_API_KEY: str = os.getenv("AZURE_VOICELIVE_API_KEY", "")
    VOICELIVE_MODEL: str = os.getenv("VOICELIVE_MODEL", "gpt-4o-realtime-preview")

    # Use token credential instead of API key
    USE_TOKEN_CREDENTIAL: bool = os.getenv("USE_TOKEN_CREDENTIAL", "false").lower() == "true"

    # Avatar configuration
    AVATAR_CHARACTER: str = os.getenv("AVATAR_CHARACTER", "lisa")
    AVATAR_STYLE: str = os.getenv("AVATAR_STYLE", "casual-sitting")
    AVATAR_CUSTOMIZED: bool = os.getenv("AVATAR_CUSTOMIZED", "false").lower() == "true"

    # Video settings
    AVATAR_VIDEO_BITRATE: int = int(os.getenv("AVATAR_VIDEO_BITRATE", "2000000"))
    AVATAR_VIDEO_CODEC: str = os.getenv("AVATAR_VIDEO_CODEC", "h264")

    # Voice settings (use multilingual voice for multi-language support)
    # Options: en-US-AvaMultilingualNeural, en-US-Ava:DragonHDLatestNeural (HD)
    VOICE_NAME: str = os.getenv("VOICE_NAME", "en-US-Ava:DragonHDLatestNeural")

    # Input language detection (comma-separated for multi-language auto-detection)
    # Default: Singapore's four official languages (English, Chinese, Malay, Tamil)
    INPUT_LANGUAGES: str = os.getenv("INPUT_LANGUAGES", "en,zh,ms,ta")

    # Assistant instructions
    ASSISTANT_INSTRUCTIONS: str = os.getenv(
        "ASSISTANT_INSTRUCTIONS",
        "You are a helpful AI voice assistant. "
        "Keep responses SHORT - maximum 2 sentences. "
        "Be concise and conversational. Never give long explanations."
    )

    # Maximum tokens for assistant response (about 2 sentences)
    MAX_RESPONSE_TOKENS: int = int(os.getenv("MAX_RESPONSE_TOKENS", "100"))

    # RAG Configuration - Azure AI Search
    AZURE_SEARCH_ENDPOINT: str = os.getenv("AZURE_SEARCH_ENDPOINT", "")
    AZURE_SEARCH_KEY: str = os.getenv("AZURE_SEARCH_KEY", "")
    AZURE_SEARCH_INDEX_NAME: str = os.getenv("AZURE_SEARCH_INDEX_NAME", "")
    AZURE_SEARCH_VECTOR_FIELD: str = os.getenv("AZURE_SEARCH_VECTOR_FIELD", "text_vector")

    # RAG Configuration - Azure OpenAI (for chat completion and embeddings)
    AZURE_OAI_ENDPOINT: str = os.getenv("AZURE_OAI_ENDPOINT", "")
    AZURE_OAI_KEY: str = os.getenv("AZURE_OAI_KEY", "")
    AZURE_OAI_DEPLOYMENT: str = os.getenv("AZURE_OAI_DEPLOYMENT", "gpt-4o-mini")
    AZURE_OAI_EMBEDDING_DEPLOYMENT: str = os.getenv("AZURE_OAI_EMBEDDING_DEPLOYMENT", "text-embedding-ada-002")
    AZURE_OAI_API_VERSION: str = os.getenv("AZURE_OAI_API_VERSION", "2024-12-01-preview")

    # Interaction mode (text, push-to-talk, realtime)
    DEFAULT_INTERACTION_MODE: str = os.getenv("DEFAULT_INTERACTION_MODE", "push-to-talk")

    # RAG enabled flag
    RAG_ENABLED: bool = os.getenv("RAG_ENABLED", "true").lower() == "true"

    def validate_and_log(self):
        """Validate configuration and log important settings."""
        logger.info("=== Voice Avatar Configuration ===")
        logger.info(f"  Endpoint: {self.VOICELIVE_ENDPOINT}")
        logger.info(f"  Model: {self.VOICELIVE_MODEL}")
        logger.info(f"  Avatar: {self.AVATAR_CHARACTER}/{self.AVATAR_STYLE}")
        logger.info(f"  Voice: {self.VOICE_NAME}")
        logger.info(f"  Input languages: {self.INPUT_LANGUAGES}")
        logger.info(f"  Video: {self.AVATAR_VIDEO_CODEC} @ {self.AVATAR_VIDEO_BITRATE} bps")
        logger.info(f"  Max response tokens: {self.MAX_RESPONSE_TOKENS}")

        # Check API key
        if not self.VOICELIVE_API_KEY and not self.USE_TOKEN_CREDENTIAL:
            logger.error("AZURE_VOICELIVE_API_KEY is not set and USE_TOKEN_CREDENTIAL is false!")
        elif self.VOICELIVE_API_KEY:
            logger.info(f"  API Key: {'*' * 8}...{self.VOICELIVE_API_KEY[-4:]}")
        else:
            logger.info("  Auth: Using token credential")

        # Check model compatibility
        if self.VOICELIVE_MODEL not in VOICELIVE_COMPATIBLE_MODELS:
            logger.warning(
                f"Model '{self.VOICELIVE_MODEL}' may not be supported for Voice Live. "
                f"See: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/regions?tabs=voice-live"
            )

        # RAG configuration
        logger.info("=== RAG Configuration ===")
        logger.info(f"  RAG Enabled: {self.RAG_ENABLED}")
        logger.info(f"  Default Mode: {self.DEFAULT_INTERACTION_MODE}")
        if self.RAG_ENABLED:
            if self.AZURE_SEARCH_ENDPOINT:
                logger.info(f"  Search Endpoint: {self.AZURE_SEARCH_ENDPOINT}")
                logger.info(f"  Search Index: {self.AZURE_SEARCH_INDEX_NAME}")
            else:
                logger.warning("  Azure Search not configured (AZURE_SEARCH_ENDPOINT missing)")
            if self.AZURE_OAI_ENDPOINT:
                logger.info(f"  OpenAI Endpoint: {self.AZURE_OAI_ENDPOINT}")
                logger.info(f"  OpenAI Deployment: {self.AZURE_OAI_DEPLOYMENT}")
            else:
                logger.warning("  Azure OpenAI not configured (AZURE_OAI_ENDPOINT missing)")
        logger.info("===================================")


settings = Settings()
settings.validate_and_log()
