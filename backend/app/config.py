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
        "AZURE_VOICELIVE_ENDPOINT", "wss://eastus2.voice.speech.microsoft.com"
    )
    VOICELIVE_API_KEY: str = os.getenv("AZURE_VOICELIVE_API_KEY", "")
    VOICELIVE_MODEL: str = os.getenv("VOICELIVE_MODEL", "gpt-4o-realtime-preview")

    # Use token credential instead of API key
    USE_TOKEN_CREDENTIAL: bool = (
        os.getenv("USE_TOKEN_CREDENTIAL", "false").lower() == "true"
    )

    # Avatar configuration
    AVATAR_CHARACTER: str = os.getenv("AVATAR_CHARACTER", "Beatriz")
    AVATAR_STYLE: str = os.getenv("AVATAR_STYLE", "")
    AVATAR_CUSTOMIZED: bool = os.getenv("AVATAR_CUSTOMIZED", "true").lower() == "true"
    AVATAR_BASE_MODEL: str = os.getenv(
        "AVATAR_BASE_MODEL", "vasa-1"
    )  # Required for photo/custom avatars

    # Video settings
    AVATAR_VIDEO_BITRATE: int = int(os.getenv("AVATAR_VIDEO_BITRATE", "2000000"))
    AVATAR_VIDEO_CODEC: str = os.getenv("AVATAR_VIDEO_CODEC", "h264")

    # Voice settings (use multilingual voice for multi-language support)
    # Options: en-US-AvaMultilingualNeural, en-US-Ava:DragonHDLatestNeural (HD)
    VOICE_NAME: str = os.getenv("VOICE_NAME", "en-US-Ava:DragonHDLatestNeural")

    # Per-language voice mappings (native voices for each language)
    # See: https://learn.microsoft.com/azure/ai-services/speech-service/language-support?tabs=tts
    VOICE_MAPPING_EN: str = os.getenv("VOICE_MAPPING_EN", "en-US-JennyNeural")
    VOICE_MAPPING_ZH: str = os.getenv("VOICE_MAPPING_ZH", "zh-CN-XiaoxiaoNeural")
    VOICE_MAPPING_ZH_HK: str = os.getenv("VOICE_MAPPING_ZH_HK", "zh-HK-HiuMaanNeural")
    VOICE_MAPPING_MS: str = os.getenv("VOICE_MAPPING_MS", "ms-MY-YasminNeural")
    VOICE_MAPPING_TA: str = os.getenv("VOICE_MAPPING_TA", "ta-IN-PallaviNeural")

    @property
    def voice_mappings(self) -> dict[str, str]:
        """Return mapping of language codes to native voice names."""
        return {
            "EN": self.VOICE_MAPPING_EN,
            "ZH": self.VOICE_MAPPING_ZH,
            "ZH-HK": self.VOICE_MAPPING_ZH_HK,
            "MS": self.VOICE_MAPPING_MS,
            "TA": self.VOICE_MAPPING_TA,
        }

    # Input language detection (comma-separated for multi-language auto-detection)
    # Default: Singapore's four official languages + Cantonese
    # en=English, zh=Mandarin, zh-HK=Cantonese, ms=Malay, ta=Tamil
    INPUT_LANGUAGES: str = os.getenv("INPUT_LANGUAGES", "en,zh,zh-HK,ms,ta")

    # Assistant instructions
    ASSISTANT_INSTRUCTIONS: str = os.getenv(
        "ASSISTANT_INSTRUCTIONS",
        "You are a helpful AI voice assistant. "
        "Keep responses SHORT - maximum 2 sentences. "
        "Be concise and conversational. Never give long explanations.",
    )

    # Maximum tokens for assistant response (about 2 sentences)
    MAX_RESPONSE_TOKENS: int = int(os.getenv("MAX_RESPONSE_TOKENS", "100"))

    # Transcription Settings
    # Models: whisper-1, gpt-4o-transcribe, gpt-4o-mini-transcribe, azure-speech
    # azure-speech recommended for multilingual (supports Cantonese, phrase lists)
    TRANSCRIPTION_MODEL: str = os.getenv("TRANSCRIPTION_MODEL", "azure-speech")

    # Phrase list for domain-specific terms (comma-separated)
    # Helps improve recognition of specific words/phrases (only used with azure-speech)
    PHRASE_LIST: str = os.getenv("PHRASE_LIST", "")

    # VAD prefix padding (ms) - audio captured before speech starts
    # Increase if first words are being missed (default: 400)
    VAD_PREFIX_PADDING_MS: int = int(os.getenv("VAD_PREFIX_PADDING_MS", "400"))

    # Turn-based mode: when true, auto-response is disabled and user must explicitly trigger response
    # In live voice mode (false), VAD automatically triggers assistant response after user stops speaking
    TURN_BASED_MODE: bool = os.getenv("TURN_BASED_MODE", "false").lower() == "true"

    # Azure AI Foundry Agent Configuration
    # Enable Foundry Agent for RAG-augmented responses
    FOUNDRY_AGENT_ENABLED: bool = (
        os.getenv("FOUNDRY_AGENT_ENABLED", "false").lower() == "true"
    )
    # Full AI Foundry project endpoint (required if enabled)
    # Format: https://<instance>.services.ai.azure.com/api/projects/<project-name>
    FOUNDRY_ENDPOINT: str = os.getenv("FOUNDRY_ENDPOINT", "")
    # Pre-created agent ID (required if enabled)
    FOUNDRY_AGENT_ID: str = os.getenv("FOUNDRY_AGENT_ID", "")

    def validate_and_log(self):
        """Validate configuration and log important settings."""
        logger.info("=== Voice Avatar Configuration ===")
        logger.info(f"  Endpoint: {self.VOICELIVE_ENDPOINT}")
        logger.info(f"  Model: {self.VOICELIVE_MODEL}")
        # Log avatar type based on configuration
        if self.AVATAR_BASE_MODEL:
            logger.info(
                f"  Avatar: {self.AVATAR_CHARACTER} (photo-avatar, {self.AVATAR_BASE_MODEL})"
            )
        else:
            logger.info(
                f"  Avatar: {self.AVATAR_CHARACTER}/{self.AVATAR_STYLE} (video-avatar)"
            )
        logger.info(f"  Voice: {self.VOICE_NAME}")
        logger.info(f"  Input languages: {self.INPUT_LANGUAGES}")
        logger.info(f"  Transcription model: {self.TRANSCRIPTION_MODEL}")
        if self.PHRASE_LIST:
            logger.info(f"  Phrase list: {self.PHRASE_LIST[:50]}...")
        logger.info(f"  VAD prefix padding: {self.VAD_PREFIX_PADDING_MS}ms")
        logger.info(
            f"  Video: {self.AVATAR_VIDEO_CODEC} @ {self.AVATAR_VIDEO_BITRATE} bps"
        )
        logger.info(f"  Max response tokens: {self.MAX_RESPONSE_TOKENS}")

        # Check API key
        if not self.VOICELIVE_API_KEY and not self.USE_TOKEN_CREDENTIAL:
            logger.error(
                "AZURE_VOICELIVE_API_KEY is not set and USE_TOKEN_CREDENTIAL is false!"
            )
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
        logger.info("===================================")


settings = Settings()
settings.validate_and_log()
