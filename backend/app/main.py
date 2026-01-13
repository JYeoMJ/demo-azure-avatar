"""
FastAPI WebSocket server for VoiceLive + Avatar.

Provides a WebSocket endpoint that bridges the browser to Azure VoiceLive,
handling audio streaming and avatar WebRTC signaling.
"""

import asyncio
import base64
import json
import logging
import time
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .voice_live import VoiceAvatarSession

# Input validation constants
MAX_AUDIO_CHUNK_SIZE = 100 * 1024  # 100KB max for audio chunks
MAX_SDP_SIZE = 10 * 1024  # 10KB max for SDP


class RateLimiter:
    """Simple token bucket rate limiter for WebSocket messages."""

    def __init__(self, max_messages: int = 100, window_seconds: float = 1.0):
        self.max_messages = max_messages
        self.window = window_seconds
        self.messages: list[float] = []

    def allow(self) -> bool:
        """Check if a message is allowed under the rate limit."""
        now = time.time()
        # Remove messages outside the window
        self.messages = [t for t in self.messages if now - t < self.window]
        if len(self.messages) >= self.max_messages:
            return False
        self.messages.append(now)
        return True


def validate_base64_data(data: str, max_size: int) -> tuple[bool, Optional[str]]:
    """
    Validate base64 encoded data.

    Returns:
        Tuple of (is_valid, error_message)
    """
    if not data:
        return False, "Empty data"
    if len(data) > max_size:
        return False, f"Data exceeds maximum size ({len(data)} > {max_size})"
    try:
        base64.b64decode(data, validate=True)
        return True, None
    except Exception as e:
        return False, f"Invalid base64 encoding: {e}"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    logger.info("Voice Avatar backend starting...")
    yield
    logger.info("Voice Avatar backend shutting down...")


app = FastAPI(
    title="Voice Avatar API",
    description="WebSocket API for VoiceLive + Avatar integration",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}


@app.websocket("/ws/voice-avatar")
async def voice_avatar_websocket(websocket: WebSocket):
    """
    WebSocket endpoint for voice avatar sessions.

    Protocol:
    - Client connects
    - Server establishes VoiceLive connection and sends session.ready with ICE servers
    - Client sends client SDP for avatar WebRTC
    - Server forwards to VoiceLive and returns server SDP
    - Client sends audio chunks as base64
    - Server forwards VoiceLive events (transcripts, status updates)
    """
    await websocket.accept()
    logger.info("WebSocket client connected")

    session = VoiceAvatarSession()
    event_task = None
    rate_limiter = RateLimiter(max_messages=100, window_seconds=1.0)
    audio_chunk_count = 0  # Per-connection counter (not global)

    try:
        # Connect to VoiceLive
        await session.connect()

        # Start event processing in background
        async def forward_events():
            """Forward VoiceLive events to WebSocket client."""
            async for event in session.process_events():
                try:
                    await websocket.send_json(event)
                except Exception as e:
                    logger.error(f"Error sending event to client: {e}")
                    break

        event_task = asyncio.create_task(forward_events())

        # Handle incoming messages from client
        while True:
            try:
                # Rate limiting
                if not rate_limiter.allow():
                    logger.warning("Rate limit exceeded for client")
                    await websocket.send_json({
                        "type": "error",
                        "message": "Rate limit exceeded",
                        "code": "rate_limited"
                    })
                    continue

                data = await websocket.receive_text()
                message = json.loads(data)
                audio_chunk_count = await handle_client_message(
                    session, message, websocket, audio_chunk_count
                )
            except WebSocketDisconnect:
                logger.info("WebSocket client disconnected")
                break
            except json.JSONDecodeError as e:
                logger.error(f"Invalid JSON from client: {e}")
                await websocket.send_json({
                    "type": "error",
                    "message": "Invalid JSON format",
                    "code": "invalid_json"
                })
            except Exception as e:
                logger.error(f"Error handling client message: {e}")
                break

    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass

    finally:
        # Cleanup
        if event_task:
            event_task.cancel()
            try:
                await event_task
            except asyncio.CancelledError:
                pass

        await session.disconnect()
        logger.info("Session cleaned up")


async def handle_client_message(
    session: VoiceAvatarSession,
    message: dict,
    websocket: WebSocket,
    audio_chunk_count: int
) -> int:
    """
    Handle messages from the WebSocket client.

    Args:
        session: The VoiceLive session
        message: The parsed message from client
        websocket: WebSocket connection for sending notifications
        audio_chunk_count: Current audio chunk counter (per-connection)

    Returns:
        Updated audio_chunk_count
    """
    msg_type = message.get("type")

    if msg_type == "audio":
        # Audio data as base64
        audio_data = message.get("data")
        if audio_data:
            # Validate audio data
            is_valid, error = validate_base64_data(audio_data, MAX_AUDIO_CHUNK_SIZE)
            if not is_valid:
                logger.warning(f"Invalid audio data: {error}")
                await websocket.send_json({
                    "type": "error",
                    "message": f"Invalid audio data: {error}",
                    "code": "invalid_audio"
                })
                return audio_chunk_count

            # Log periodically to avoid spam (every 100 chunks = ~17 seconds at 4096 samples/24kHz)
            audio_chunk_count += 1
            if audio_chunk_count % 100 == 1:
                logger.info(f"Audio streaming... (chunk #{audio_chunk_count}, size: {len(audio_data)} chars)")

            # Send audio and notify client if dropped
            audio_sent = await session.send_audio(audio_data)
            if not audio_sent:
                await websocket.send_json({
                    "type": "audio.dropped",
                    "reason": "session_not_ready"
                })

    elif msg_type == "avatar.sdp":
        # Client SDP for avatar WebRTC
        client_sdp = message.get("sdp")
        if client_sdp:
            # Validate SDP size
            if len(client_sdp) > MAX_SDP_SIZE:
                logger.warning(f"SDP exceeds maximum size: {len(client_sdp)} > {MAX_SDP_SIZE}")
                await websocket.send_json({
                    "type": "error",
                    "message": "SDP exceeds maximum allowed size",
                    "code": "invalid_sdp"
                })
                return audio_chunk_count

            logger.info(f"Received client SDP for avatar (length: {len(client_sdp)} chars)")
            await session.send_avatar_sdp(client_sdp)
        else:
            logger.warning("Received avatar.sdp message but 'sdp' field is missing/empty")

    else:
        logger.warning(f"Unknown message type: {msg_type}")

    return audio_chunk_count


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
