"""
FastAPI WebSocket server for VoiceLive + Avatar.

Provides a WebSocket endpoint that bridges the browser to Azure VoiceLive,
handling audio streaming and avatar WebRTC signaling.
"""

import asyncio
import json
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .voice_live import VoiceAvatarSession

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
                data = await websocket.receive_text()
                message = json.loads(data)
                await handle_client_message(session, message)
            except WebSocketDisconnect:
                logger.info("WebSocket client disconnected")
                break
            except json.JSONDecodeError as e:
                logger.error(f"Invalid JSON from client: {e}")
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


async def handle_client_message(session: VoiceAvatarSession, message: dict):
    """Handle messages from the WebSocket client."""
    msg_type = message.get("type")

    if msg_type == "audio":
        # Audio data as base64
        audio_data = message.get("data")
        if audio_data:
            # Log periodically to avoid spam (every 100 chunks = ~17 seconds at 4096 samples/24kHz)
            if not hasattr(handle_client_message, '_audio_count'):
                handle_client_message._audio_count = 0
            handle_client_message._audio_count += 1
            if handle_client_message._audio_count % 100 == 1:
                logger.info(f"Audio streaming... (chunk #{handle_client_message._audio_count}, size: {len(audio_data)} chars)")
            await session.send_audio(audio_data)

    elif msg_type == "avatar.sdp":
        # Client SDP for avatar WebRTC
        client_sdp = message.get("sdp")
        if client_sdp:
            logger.info(f"Received client SDP for avatar (length: {len(client_sdp)} chars)")
            await session.send_avatar_sdp(client_sdp)
        else:
            logger.warning("Received avatar.sdp message but 'sdp' field is missing/empty")

    else:
        logger.warning(f"Unknown message type: {msg_type}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
