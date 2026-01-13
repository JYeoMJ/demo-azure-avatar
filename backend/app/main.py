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
from .config import settings

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

    # Create session with default interaction mode
    session = VoiceAvatarSession(mode=settings.DEFAULT_INTERACTION_MODE)
    event_task = None
    session_id = f"session-{id(websocket)}"  # Unique session ID for RAG memory

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
                await handle_client_message(session, message, session_id, websocket)
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


async def handle_client_message(
    session: VoiceAvatarSession,
    message: dict,
    session_id: str,
    websocket: WebSocket
):
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

    elif msg_type == "mode.set":
        # Set interaction mode (async with session reconfiguration)
        mode = message.get("mode", "push-to-talk")
        success = await session.set_mode(mode)
        await websocket.send_json({
            "type": "mode.changed",
            "mode": session.mode,
            "success": success
        })

    elif msg_type == "audio.clear":
        # Clear audio buffer (push-to-talk start)
        await session.clear_audio_buffer()

    elif msg_type == "audio.commit":
        # Commit audio buffer and trigger response (push-to-talk release)
        if settings.RAG_ENABLED:
            # For RAG mode, we'll intercept the transcript and generate RAG response
            # The transcript will come through the event handler
            await session.commit_audio_and_respond()
            # Note: RAG integration for voice mode would require intercepting
            # the transcript event and injecting RAG response - this is a TODO
        else:
            await session.commit_audio_and_respond()

    elif msg_type == "text.input":
        # Text input (text chat mode)
        text = message.get("text", "").strip()
        if text:
            logger.info(f"Received text input: {text[:50]}...")

            if settings.RAG_ENABLED:
                # Use RAG to generate grounded response
                try:
                    await websocket.send_json({"type": "rag.started", "query": text})

                    # Import here to avoid circular imports
                    from .rag_service import generate_rag_response

                    rag_result = await generate_rag_response(
                        query=text,
                        session_id=session_id,
                        lang="en",  # TODO: detect language
                        req_id=f"req-{id(message)}"
                    )

                    response_text = rag_result.get("response", "")
                    sources = rag_result.get("sources", [])

                    # Send RAG sources to client
                    await websocket.send_json({
                        "type": "rag.sources",
                        "sources": sources
                    })

                    # Send user transcript
                    await websocket.send_json({
                        "type": "transcript",
                        "role": "user",
                        "text": text
                    })

                    # Inject RAG response for avatar to speak
                    if response_text:
                        await session.inject_rag_response(response_text)
                        # Send assistant transcript
                        await websocket.send_json({
                            "type": "transcript",
                            "role": "assistant",
                            "text": response_text
                        })

                except Exception as e:
                    logger.error(f"RAG error: {e}")
                    await websocket.send_json({
                        "type": "rag.error",
                        "message": str(e)
                    })
                    # Fallback to non-RAG response
                    await session.send_text_input(text)
            else:
                # Non-RAG mode: send directly to VoiceLive
                await session.send_text_input(text)

    else:
        logger.warning(f"Unknown message type: {msg_type}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
