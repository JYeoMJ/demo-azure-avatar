"""
VoiceLive + Avatar Session Handler

Manages real-time voice conversation with Azure VoiceLive SDK,
including avatar video streaming configuration.
"""

import asyncio
import base64
import json
import logging
import time
from typing import AsyncGenerator, Optional, Union, Any

from azure.core.credentials import AzureKeyCredential, TokenCredential
from azure.identity import DefaultAzureCredential
from azure.ai.voicelive.aio import connect, VoiceLiveConnection
from azure.ai.voicelive.models import (
    RequestSession,
    AzureSemanticVadMultilingual,
    AzureSemanticDetectionMultilingual,
    AzureStandardVoice,
    Modality,
    InputAudioFormat,
    OutputAudioFormat,
    AudioInputTranscriptionOptions,
    AudioEchoCancellation,
    AudioNoiseReduction,
)

from .config import settings
from .foundry_agent import foundry_agent

logger = logging.getLogger(__name__)


def detect_language(text: str) -> str:
    """Detect language from text using Unicode character ranges."""
    if not text:
        return "EN"

    for char in text:
        code = ord(char)
        # Chinese (CJK Unified Ideographs)
        if 0x4E00 <= code <= 0x9FFF:
            return "ZH"
        # Tamil
        if 0x0B80 <= code <= 0x0BFF:
            return "TA"
        # Japanese Hiragana/Katakana
        if 0x3040 <= code <= 0x30FF:
            return "JA"
        # Korean Hangul
        if 0xAC00 <= code <= 0xD7AF or 0x1100 <= code <= 0x11FF:
            return "KO"

    # Default to English for Latin text
    return "EN"


# Error codes that are expected during normal operation and should not be forwarded to client
# These typically occur due to race conditions that are inherent to real-time voice interactions
EXPECTED_ERROR_CODES = {
    "response_cancel_not_active",  # User interrupted after response already completed
}

# Rate limit protection: minimum seconds between RAG context retrieval calls
CONTEXT_DEBOUNCE_SECONDS = 2.0


def _encode_client_sdp(client_sdp: str) -> str:
    """Encode SDP as base64 JSON for Azure VoiceLive avatar."""
    payload = json.dumps({"type": "offer", "sdp": client_sdp})
    return base64.b64encode(payload.encode("utf-8")).decode("ascii")


def _decode_server_sdp(server_sdp_raw: Optional[str]) -> Optional[str]:
    """Decode server SDP from base64 JSON or return as-is if plain."""
    if not server_sdp_raw:
        return None
    # Already plain SDP (starts with version line)
    if server_sdp_raw.startswith("v=0"):
        return server_sdp_raw
    try:
        decoded_bytes = base64.b64decode(server_sdp_raw)
        decoded_text = decoded_bytes.decode("utf-8")
        payload = json.loads(decoded_text)
        if isinstance(payload, dict) and "sdp" in payload:
            return payload["sdp"]
        return decoded_text
    except Exception:
        # If decoding fails, return as-is
        return server_sdp_raw


# Timeout constants for Azure SDK operations
SESSION_UPDATE_TIMEOUT = 15.0  # Timeout for session.update()
SEND_TIMEOUT = 10.0  # Timeout for connection.send() calls
DISCONNECT_TIMEOUT = 5.0  # Timeout for disconnect operations
EVENT_QUEUE_MAXSIZE = 100  # Prevent unbounded memory growth


class VoiceAvatarSession:
    """
    Manages a VoiceLive session with avatar integration.

    Handles:
    - WebSocket connection to Azure VoiceLive
    - Session configuration with avatar settings
    - Audio input/output streaming
    - Avatar WebRTC SDP exchange
    - Turn-based vs live voice mode switching
    """

    def __init__(self):
        self.connection: Optional[VoiceLiveConnection] = None
        self._connection_cm = None  # Store context manager for proper cleanup
        # Use asyncio.Event for thread-safe session ready signaling
        self._session_ready_event = asyncio.Event()
        self.avatar_ice_servers: list[dict] = []
        # Bound queue to prevent memory growth if client disconnects
        self._event_queue: asyncio.Queue = asyncio.Queue(maxsize=EVENT_QUEUE_MAXSIZE)
        self._response_in_progress = False
        self._turn_based_mode = settings.TURN_BASED_MODE
        self._base_instructions = settings.ASSISTANT_INSTRUCTIONS
        self._background_tasks: set[asyncio.Task] = set()  # Track background tasks
        # Rate limit protection for RAG context retrieval
        self._context_semaphore = asyncio.Semaphore(1)  # Max 1 concurrent context call
        self._last_context_time = 0.0
        self._last_context_query = ""
        # Session-based Foundry Agent thread management
        self._foundry_thread_id: Optional[str] = None
        self._recent_user_messages: list[str] = []  # Last 3 messages for context
        # Initialize Foundry Agent if enabled
        foundry_agent.initialize()

    @property
    def session_ready(self) -> bool:
        """Check if session is ready (thread-safe via asyncio.Event)."""
        return self._session_ready_event.is_set()

    def _set_session_ready(self) -> None:
        """Mark session as ready (thread-safe)."""
        self._session_ready_event.set()

    def _clear_session_ready(self) -> None:
        """Mark session as not ready (thread-safe)."""
        self._session_ready_event.clear()

    async def _send_with_timeout(self, message: dict, timeout: float = SEND_TIMEOUT) -> bool:
        """
        Send a message to VoiceLive with timeout protection.

        Args:
            message: The message dict to send
            timeout: Timeout in seconds (default: SEND_TIMEOUT)

        Returns:
            True if sent successfully, False if timed out or failed
        """
        if not self.connection:
            logger.warning("Cannot send: no connection")
            return False

        try:
            await asyncio.wait_for(
                self.connection.send(message),
                timeout=timeout,
            )
            return True
        except asyncio.TimeoutError:
            logger.error(f"Send timed out after {timeout}s for message type: {message.get('type', 'unknown')}")
            return False
        except Exception as e:
            logger.error(f"Send failed: {e}")
            return False

    def _get_credential(self) -> Union[AzureKeyCredential, TokenCredential]:
        """Get the appropriate credential based on configuration."""
        if settings.USE_TOKEN_CREDENTIAL:
            return DefaultAzureCredential()
        return AzureKeyCredential(settings.VOICELIVE_API_KEY)

    def _build_session_config(self) -> RequestSession:
        """Build the session configuration with avatar settings."""
        # Voice configuration
        voice_config: Union[AzureStandardVoice, str]
        if "-" in settings.VOICE_NAME:
            voice_config = AzureStandardVoice(
                name=settings.VOICE_NAME, type="azure-standard"
            )
        else:
            voice_config = settings.VOICE_NAME

        # Semantic end-of-utterance detection
        eou_detection = AzureSemanticDetectionMultilingual(
            threshold_level="medium",
            timeout_ms=1000,
        )

        # Semantic VAD with multilingual support
        # In turn-based mode, disable auto-response so user must explicitly trigger
        turn_detection = AzureSemanticVadMultilingual(
            threshold=0.5,
            prefix_padding_ms=300,
            silence_duration_ms=800 if self._turn_based_mode else 500,
            create_response=not self._turn_based_mode,  # Disable auto-response in turn-based mode
            end_of_utterance_detection=eou_detection,
        )

        # Avatar configuration (must match Azure VoiceLive format)
        # Photo avatars require different config than video avatars
        is_photo_avatar = bool(settings.AVATAR_BASE_MODEL)

        avatar_config = {
            "character": settings.AVATAR_CHARACTER,
            "customized": settings.AVATAR_CUSTOMIZED
            or is_photo_avatar,  # Photo avatars need customized=true
            "video": {
                "resolution": {
                    "width": 512 if is_photo_avatar else 1280,
                    "height": 512 if is_photo_avatar else 720,
                },
                "bitrate": settings.AVATAR_VIDEO_BITRATE,
            },
        }

        # Photo avatar specific config
        if is_photo_avatar:
            avatar_config["type"] = "photo-avatar"
            avatar_config["model"] = settings.AVATAR_BASE_MODEL  # e.g., "vasa-1"
        else:
            avatar_config["type"] = "video-avatar"
            # Style only for video avatars
            if settings.AVATAR_STYLE:
                avatar_config["style"] = settings.AVATAR_STYLE

        # Input transcription with multi-language auto-detection
        # Supports: whisper-1, gpt-4o-transcribe, gpt-4o-mini-transcribe, azure-speech
        input_transcription = AudioInputTranscriptionOptions(
            model="whisper-1",
            language=settings.INPUT_LANGUAGES,  # e.g., "en,zh,ja" for auto-detection
        )

        # Avatar enabled - requires resource in supported region
        # (Southeast Asia, West US 2, East US 2, West Europe, North Europe, Sweden Central, South Central US)
        # Audio will be routed through WebRTC when avatar is enabled
        return RequestSession(
            modalities=[Modality.TEXT, Modality.AUDIO],
            instructions=settings.ASSISTANT_INSTRUCTIONS,
            voice=voice_config,
            input_audio_format=InputAudioFormat.PCM16,
            output_audio_format=OutputAudioFormat.PCM16,
            turn_detection=turn_detection,
            input_audio_transcription=input_transcription,
            max_response_output_tokens=settings.MAX_RESPONSE_TOKENS,
            avatar=avatar_config,
            input_audio_echo_cancellation=AudioEchoCancellation(),
            input_audio_noise_reduction=AudioNoiseReduction(type="azure_deep_noise_suppression"),
        )

    async def connect(self) -> dict:
        """
        Establish connection to VoiceLive and configure session.

        Returns:
            dict with session info including ICE servers for avatar WebRTC
        """
        logger.info(f"Connecting to VoiceLive at {settings.VOICELIVE_ENDPOINT}")

        credential = self._get_credential()

        # Store context manager for proper cleanup in disconnect()
        self._connection_cm = connect(
            endpoint=settings.VOICELIVE_ENDPOINT,
            credential=credential,
            model=settings.VOICELIVE_MODEL,
            connection_options={
                "max_msg_size": 10 * 1024 * 1024,
                "heartbeat": 20,
                "timeout": 20,
            },
        )
        self.connection = await self._connection_cm.__aenter__()

        # Configure session with avatar
        session_config = self._build_session_config()
        logger.info(
            f"Session config: voice={settings.VOICE_NAME}, "
            f"input_langs={settings.INPUT_LANGUAGES}, max_tokens={settings.MAX_RESPONSE_TOKENS}"
        )
        # Add timeout to prevent hanging if Azure doesn't respond
        try:
            await asyncio.wait_for(
                self.connection.session.update(session=session_config),
                timeout=SESSION_UPDATE_TIMEOUT,
            )
        except asyncio.TimeoutError:
            logger.error(f"Session update timed out after {SESSION_UPDATE_TIMEOUT}s")
            raise RuntimeError("Session configuration timed out")

        logger.info("VoiceLive session configured, waiting for session.updated event")

        # Create Foundry Agent thread for this session (if enabled)
        if foundry_agent.enabled:
            self._foundry_thread_id = foundry_agent.create_thread()
            if self._foundry_thread_id:
                logger.info(
                    f"Created Foundry Agent thread for session: {self._foundry_thread_id}"
                )

        return {"status": "connecting"}

    async def send_audio(self, audio_base64: str) -> bool:
        """
        Send audio data to VoiceLive.

        Returns:
            True if audio was sent, False if dropped (session not ready)
        """
        if self.connection and self.session_ready:
            await self.connection.input_audio_buffer.append(audio=audio_base64)
            return True
        elif not self.session_ready:
            logger.warning("Audio dropped: session not ready yet")
            return False
        return False

    async def send_text_input(self, text: str) -> bool:
        """
        Send text input to VoiceLive as a user message.

        In turn-based mode with Foundry Agent enabled:
        - Uses Foundry Agent for full RAG+LLM response
        - Sends the response to VoiceLive for TTS rendering

        In live voice mode or without Foundry Agent:
        - Injects context from Foundry Agent (if enabled)
        - Lets VoiceLive generate the response

        Returns:
            True if text was sent, False if session not ready
        """
        if not self.connection or not self.session_ready:
            logger.warning("Text input dropped: session not ready yet")
            return False

        try:
            logger.info(f"Sending text input: {text[:50]}...")

            # Track user message for conversation context (keep last 3)
            self._recent_user_messages.append(text)
            if len(self._recent_user_messages) > 3:
                self._recent_user_messages.pop(0)

            # Create user message conversation item
            if not await self._send_with_timeout(
                {
                    "type": "conversation.item.create",
                    "item": {
                        "type": "message",
                        "role": "user",
                        "content": [{"type": "input_text", "text": text}],
                    },
                }
            ):
                logger.error("Failed to send user message")
                return False

            # In turn-based mode with Foundry Agent, use agent for full response
            if self._turn_based_mode and foundry_agent.enabled:
                logger.info("Using Foundry Agent for full response generation")
                response_text = foundry_agent.process_query(text)

                if response_text:
                    logger.info(f"Foundry Agent response: {response_text[:100]}...")
                    # Create assistant message with the pre-generated response
                    # VoiceLive will render this as TTS with avatar
                    if not await self._send_with_timeout(
                        {
                            "type": "conversation.item.create",
                            "item": {
                                "type": "message",
                                "role": "assistant",
                                "content": [{"type": "text", "text": response_text}],
                            },
                        }
                    ):
                        logger.error("Failed to send assistant message")
                        return False
                    # Trigger response to render the assistant message as audio
                    if not await self._send_with_timeout({"type": "response.create"}):
                        logger.error("Failed to trigger response")
                        return False
                    return True
                else:
                    # Foundry Agent failed, fall back to VoiceLive's LLM
                    logger.warning(
                        "Foundry Agent returned no response, using VoiceLive fallback"
                    )

            # Default: inject context and let VoiceLive generate response
            await self._inject_rag_context(text)
            if not await self._send_with_timeout({"type": "response.create"}):
                logger.error("Failed to create response")
                return False
            return True

        except Exception as e:
            logger.error(f"Error sending text input: {e}")
            return False

    async def trigger_response(self) -> bool:
        """
        Explicitly trigger assistant response (for turn-based mode).

        In turn-based mode, the assistant doesn't auto-respond after VAD
        detects end of speech. This method allows manual triggering.

        Returns:
            True if response was triggered, False if session not ready
        """
        if not self.connection or not self.session_ready:
            logger.warning("Cannot trigger response: session not ready")
            return False

        try:
            logger.info("Manually triggering assistant response")
            if not await self._send_with_timeout({"type": "response.create"}):
                logger.error("Trigger response timed out")
                return False
            return True
        except Exception as e:
            logger.error(f"Error triggering response: {e}")
            return False

    async def set_mode(self, turn_based: bool) -> bool:
        """
        Switch between turn-based and live voice mode at runtime.

        Args:
            turn_based: True for turn-based mode, False for live voice mode

        Returns:
            True if mode was updated, False if failed
        """
        if not self.connection or not self.session_ready:
            logger.warning("Cannot set mode: session not ready")
            return False

        try:
            self._turn_based_mode = turn_based
            logger.info(
                f"Switching to {'turn-based' if turn_based else 'live voice'} mode"
            )

            # Update session turn detection configuration
            turn_detection_config = {
                "type": "azure_semantic_vad_multilingual",
                "threshold": 0.5,
                "prefix_padding_ms": 300,
                "silence_duration_ms": 800 if turn_based else 500,
                "create_response": not turn_based,
                "end_of_utterance_detection": {
                    "type": "azure_semantic_detection_multilingual",
                    "threshold_level": "medium",
                    "timeout_ms": 1000,
                },
            }

            if not await self._send_with_timeout(
                {
                    "type": "session.update",
                    "session": {"turn_detection": turn_detection_config},
                }
            ):
                logger.error("Failed to update session mode")
                return False
            return True
        except Exception as e:
            logger.error(f"Error setting mode: {e}")
            return False

    @property
    def is_turn_based_mode(self) -> bool:
        """Return current mode setting."""
        return self._turn_based_mode

    async def _inject_rag_context_background(self, query: str) -> None:
        """
        Background task to retrieve and inject RAG context without blocking event stream.

        Includes rate limit protection:
        - Debouncing: Skip if called too recently (within CONTEXT_DEBOUNCE_SECONDS)
        - Duplicate detection: Skip if query is identical to last one
        - Concurrency limiting: Only 1 context call at a time (semaphore)

        Args:
            query: The user's query (transcribed speech or text input)
        """
        if not foundry_agent.enabled:
            return

        # Debounce: skip if called too recently
        now = time.time()
        if now - self._last_context_time < CONTEXT_DEBOUNCE_SECONDS:
            logger.debug(
                f"Skipping context retrieval (debounce: {now - self._last_context_time:.1f}s < {CONTEXT_DEBOUNCE_SECONDS}s)"
            )
            return

        # Skip if query is very similar to last one (case-insensitive)
        if query.strip().lower() == self._last_context_query.strip().lower():
            logger.debug("Skipping context retrieval (duplicate query)")
            return

        # Limit concurrency to 1 - if another call is in progress, skip this one
        if not self._context_semaphore.locked():
            async with self._context_semaphore:
                try:
                    # Update tracking before the call
                    self._last_context_time = time.time()
                    self._last_context_query = query

                    # Get conversation context (previous messages, excluding current query)
                    # Use all but the last message since last message IS the current query
                    conversation_context = (
                        self._recent_user_messages[:-1]
                        if len(self._recent_user_messages) > 1
                        else None
                    )

                    # Run synchronous Foundry Agent call in thread pool to avoid blocking
                    # Pass thread_id for session-based context and conversation history
                    # Use timeout to prevent thread pool exhaustion if Foundry hangs
                    try:
                        context = await asyncio.wait_for(
                            asyncio.to_thread(
                                foundry_agent.get_context,
                                query,
                                thread_id=self._foundry_thread_id,
                                conversation_context=conversation_context,
                            ),
                            timeout=10.0,
                        )
                    except asyncio.TimeoutError:
                        logger.warning(
                            "Foundry Agent context retrieval timed out after 10s"
                        )
                        return
                    if not context:
                        logger.debug("No relevant context found from Foundry Agent")
                        return

                    augmented_instructions = f"{self._base_instructions}\n\n{context}"
                    logger.info(
                        f"Injecting Foundry Agent context ({len(context)} chars)"
                    )

                    # Update session with augmented instructions
                    if self.connection and self.session_ready:
                        if not await self._send_with_timeout(
                            {
                                "type": "session.update",
                                "session": {"instructions": augmented_instructions},
                            }
                        ):
                            logger.warning("Failed to inject RAG context (timeout)")

                except Exception as e:
                    logger.error(f"Background RAG injection failed: {e}")
        else:
            logger.debug("Skipping context retrieval (another call in progress)")

    def _track_task(self, task: asyncio.Task) -> None:
        """Track a background task and clean up when done."""
        self._background_tasks.add(task)
        task.add_done_callback(self._background_tasks.discard)

    async def _inject_rag_context(self, query: str) -> bool:
        """
        Fire-and-forget RAG context injection - doesn't block event processing.

        Args:
            query: The user's query (transcribed speech or text input)

        Returns:
            True if background task was started, False otherwise
        """
        if not foundry_agent.enabled:
            return False

        # Fire and forget - but track for cleanup on disconnect
        task = asyncio.create_task(self._inject_rag_context_background(query))
        self._track_task(task)
        return True

    async def _cancel_response_async(self) -> None:
        """Fire-and-forget response cancellation."""
        try:
            if self.connection:
                await self.connection.response.cancel()
        except Exception as e:
            # Expected errors during cancellation (e.g., response already done)
            logger.debug(f"Response cancel (expected): {e}")

    async def send_avatar_sdp(self, client_sdp: str) -> bool:
        """
        Send client SDP for avatar WebRTC connection.

        Returns:
            True if sent successfully, False otherwise
        """
        if self.connection:
            logger.info(f"Sending avatar SDP offer (length: {len(client_sdp)} chars)")
            # Encode SDP as base64 JSON (required by Azure VoiceLive)
            encoded_sdp = _encode_client_sdp(client_sdp)
            logger.debug(f"Encoded SDP length: {len(encoded_sdp)} chars")
            if await self._send_with_timeout(
                {
                    "type": "session.avatar.connect",
                    "client_sdp": encoded_sdp,
                    "rtc_configuration": {"bundle_policy": "max-bundle"},
                }
            ):
                logger.info("Avatar connect message sent successfully")
                return True
            else:
                logger.error("Avatar connect message timed out")
                return False
        else:
            logger.error("Cannot send avatar SDP: no connection")
            return False

    async def process_events(self) -> AsyncGenerator[dict, None]:
        """
        Process events from VoiceLive connection.

        Yields events as dictionaries for the WebSocket client.
        """
        if not self.connection:
            return

        try:
            async for event in self.connection:
                event_data = await self._handle_event(event)
                if event_data:
                    yield event_data
        except Exception as e:
            logger.error(f"Error processing events: {e}")
            yield {"type": "error", "message": str(e)}

    async def _handle_event(self, event: Any) -> Optional[dict]:
        """Handle a single VoiceLive event and return data for client."""
        # Get event type as string - Azure SDK returns strings, not enums
        event_type_str = str(event.type) if event.type else "unknown"

        # Only log non-delta events to reduce noise
        if "delta" not in event_type_str:
            logger.info(f"Received event: {event_type_str}")

        # Session events
        if event_type_str == "session.updated":
            self._set_session_ready()
            # Extract ICE servers if provided
            ice_servers_list = []
            if hasattr(event, "session") and hasattr(event.session, "avatar"):
                avatar_info = event.session.avatar
                if hasattr(avatar_info, "ice_servers") and avatar_info.ice_servers:
                    for server in avatar_info.ice_servers:
                        ice_server_dict = {
                            "urls": server.urls if hasattr(server, "urls") else [],
                        }
                        if hasattr(server, "username") and server.username:
                            ice_server_dict["username"] = server.username
                        if hasattr(server, "credential") and server.credential:
                            ice_server_dict["credential"] = server.credential
                        ice_servers_list.append(ice_server_dict)
            self.avatar_ice_servers = ice_servers_list

            logger.info(f"Session ready with {len(ice_servers_list)} ICE server(s)")
            if ice_servers_list:
                logger.info(f"ICE servers: {ice_servers_list}")
            return {"type": "session.ready", "ice_servers": self.avatar_ice_servers}

        elif event_type_str == "session.avatar.connecting":
            # Server SDP for WebRTC (may be base64-encoded JSON)
            logger.info(
                f"Received avatar connecting event. Has server_sdp: {hasattr(event, 'server_sdp')}"
            )
            server_sdp_raw = event.server_sdp if hasattr(event, "server_sdp") else None
            if server_sdp_raw:
                logger.info(
                    f"Raw server SDP received (length: {len(server_sdp_raw)} chars)"
                )
                # Decode if needed (Azure may return base64-encoded JSON)
                server_sdp = _decode_server_sdp(server_sdp_raw)
                logger.info(
                    f"Decoded server SDP (length: {len(server_sdp) if server_sdp else 0} chars)"
                )
            else:
                logger.error("Avatar connecting event has no server_sdp!")
                server_sdp = None
            return {"type": "avatar.sdp", "server_sdp": server_sdp}

        elif event_type_str == "session.avatar.connected":
            logger.info("Avatar WebRTC connection established")
            return {"type": "avatar.connected"}

        elif event_type_str in ("session.avatar.error", "session.avatar.failed"):
            # Avatar connection failed - frontend should fall back to voice-only
            error_msg = "Avatar connection failed"
            if hasattr(event, "error"):
                error_msg = str(event.error)
            elif hasattr(event, "message"):
                error_msg = event.message
            logger.error(f"Avatar error: {error_msg}")
            return {"type": "avatar.error", "message": error_msg}

        # Voice activity detection events
        elif event_type_str == "input_audio_buffer.speech_started":
            logger.info("User started speaking")
            # If assistant is responding, cancel to allow interruption (fire-and-forget)
            if self._response_in_progress and self.connection:
                logger.info("Cancelling in-progress response (user interruption)")
                # Fire and forget - but track for cleanup on disconnect
                task = asyncio.create_task(self._cancel_response_async())
                self._track_task(task)
                # Immediately mark as cancelled for responsive UI
                self._response_in_progress = False
            return {"type": "user.speaking.started"}

        elif event_type_str == "input_audio_buffer.speech_stopped":
            logger.info("User stopped speaking")
            return {"type": "user.speaking.stopped"}

        elif event_type_str == "input_audio_buffer.committed":
            # Audio buffer committed, no action needed
            return None

        # Transcript events - User speech
        elif event_type_str == "conversation.item.input_audio_transcription.completed":
            # User's speech has been transcribed
            transcript = None
            if hasattr(event, "transcript"):
                transcript = event.transcript
            logger.info(f"User transcript: {transcript}")
            if transcript and transcript.strip():
                logger.info(f"Sending user transcript to client: {transcript[:50]}...")
                # Track user message for conversation context (keep last 3)
                self._recent_user_messages.append(transcript)
                if len(self._recent_user_messages) > 3:
                    self._recent_user_messages.pop(0)
                # Fire-and-forget RAG context injection (returns immediately, runs in background)
                await self._inject_rag_context(transcript)
                return {
                    "type": "transcript",
                    "role": "user",
                    "text": transcript,
                    "language": detect_language(transcript),
                }
            return None

        # Response events
        elif event_type_str == "response.created":
            logger.info("Assistant response created")
            self._response_in_progress = True
            return {"type": "assistant.response.started"}

        elif event_type_str == "response.output_item.added":
            # Output item added, no action needed
            return None

        elif event_type_str == "response.content_part.added":
            # Content part added, no action needed
            return None

        # Audio streaming events (for voice-only mode without avatar)
        elif event_type_str == "response.audio.delta":
            # Forward audio chunks to client for playback
            audio_data = None
            if hasattr(event, "delta"):
                audio_data = event.delta
            if audio_data:
                # Convert bytes to base64 string for JSON serialization
                if isinstance(audio_data, bytes):
                    audio_data = base64.b64encode(audio_data).decode("utf-8")
                return {"type": "audio.delta", "data": audio_data}
            return None

        elif event_type_str == "response.audio.done":
            logger.info("Assistant audio done")
            return {"type": "assistant.speaking.done"}

        # Transcript events - Assistant response (streaming)
        elif event_type_str == "response.audio_transcript.delta":
            # Forward incremental transcript updates for real-time display
            delta = getattr(event, "delta", None)
            if delta:
                logger.debug(f"Transcript delta: {delta}")
                return {"type": "transcript.delta", "role": "assistant", "delta": delta}
            return None

        elif event_type_str == "response.audio_transcript.done":
            # Complete assistant transcript
            transcript = None
            if hasattr(event, "transcript"):
                transcript = event.transcript
            logger.info(f"Assistant transcript: {transcript}")
            if transcript and transcript.strip():
                logger.info(
                    f"Sending assistant transcript to client: {transcript[:50]}..."
                )
                return {"type": "transcript", "role": "assistant", "text": transcript}
            return None

        elif event_type_str == "response.content_part.done":
            # Content part done, no action needed
            return None

        elif event_type_str == "response.output_item.done":
            # Output item done, no action needed
            return None

        elif event_type_str == "response.done":
            logger.info("Response complete")
            self._response_in_progress = False
            return {"type": "assistant.response.done"}

        elif event_type_str == "response.cancelled":
            logger.info("Response cancelled (user interruption)")
            self._response_in_progress = False
            return {"type": "assistant.response.cancelled"}

        # Conversation item events
        elif event_type_str == "conversation.item.created":
            # Item created - transcript might be in here for some event types
            return None

        # Error events
        elif event_type_str == "error":
            error_msg = "Unknown error"
            error_code = "unknown"
            if hasattr(event, "error"):
                if isinstance(event.error, dict):
                    error_msg = event.error.get("message", str(event.error))
                    error_code = event.error.get("code", "unknown")
                elif hasattr(event.error, "message"):
                    error_msg = event.error.message
                    error_code = (
                        event.error.code if hasattr(event.error, "code") else "unknown"
                    )

            # Filter out expected errors that shouldn't be shown to user
            if error_code in EXPECTED_ERROR_CODES:
                logger.debug(f"Ignoring expected error: [{error_code}] {error_msg}")
                return None  # Don't forward to client

            logger.error(f"VoiceLive error: [{error_code}] {error_msg}")
            return {"type": "error", "message": error_msg, "code": error_code}

        elif event_type_str == "response.audio_timestamp.delta":
            # Word-level timestamps for avatar sync
            return {
                "type": "audio.timestamp",
                "text": event.text if hasattr(event, "text") else None,
                "offset_ms": event.audio_offset_ms
                if hasattr(event, "audio_offset_ms")
                else None,
            }

        # Log unhandled events for debugging
        logger.debug(f"Unhandled event type: {event_type_str}")
        return None

    async def disconnect(self) -> None:
        """Disconnect from VoiceLive."""
        # Cancel all tracked background tasks
        for task in list(self._background_tasks):
            if not task.done():
                task.cancel()
        # Wait for all tasks to complete cancellation
        if self._background_tasks:
            await asyncio.gather(*self._background_tasks, return_exceptions=True)
        self._background_tasks.clear()

        # Delete Foundry Agent thread for this session
        if self._foundry_thread_id:
            try:
                foundry_agent.delete_thread(self._foundry_thread_id)
            except Exception as e:
                logger.warning(f"Failed to delete Foundry thread: {e}")
            finally:
                self._foundry_thread_id = None
                self._recent_user_messages.clear()

        # Properly exit the connection context manager
        if self._connection_cm:
            try:
                await self._connection_cm.__aexit__(None, None, None)
            except Exception as e:
                logger.error(f"Error exiting connection context: {e}")
            finally:
                self._connection_cm = None
                self.connection = None
                self._clear_session_ready()
        elif self.connection:
            # Fallback if connection was created without context manager
            try:
                if hasattr(self.connection, "close"):
                    await self.connection.close()
            except Exception as e:
                logger.error(f"Error disconnecting: {e}")
            finally:
                self.connection = None
                self._clear_session_ready()
        logger.info("Disconnected from VoiceLive")
