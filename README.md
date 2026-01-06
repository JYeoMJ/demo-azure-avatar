# Voice Avatar

Real-time voice conversation with AI-powered lip-synced avatar using Azure VoiceLive SDK.

```
Browser ──WebSocket──► FastAPI Backend ──► Azure VoiceLive (GPT-4o)
   │                                              │
   │◄════════════ WebRTC Video Stream ════════════│
```

## Features

- **Real-time Voice Conversation** - Natural back-and-forth dialogue with AI
- **Lip-synced Avatar** - Live video avatar with synchronized speech via WebRTC
- **Multilingual Support** - Auto-detects English, Chinese, Malay, Tamil (configurable)
- **HD Voice Quality** - Azure Neural TTS with Dragon HD voices
- **Voice Activity Detection** - Server-side VAD with user interruption support
- **Voice-only Fallback** - Graceful degradation when avatar unavailable

## Prerequisites

- Python 3.11+ with [uv](https://docs.astral.sh/uv/)
- Node.js 18+
- Azure subscription with:
  - [Azure AI Foundry](https://ai.azure.com) resource (recommended) or Speech Services
  - VoiceLive API access

### Avatar-supported Regions

Avatar streaming requires your Azure resource to be in one of these regions:
- Southeast Asia
- West US 2, East US 2, South Central US
- West Europe, North Europe, Sweden Central

## Quick Start

### 1. Backend

```bash
cd backend

# Install dependencies
uv sync

# Configure environment
cp .env.example .env
# Edit .env with your Azure credentials

# Run server
uv run uvicorn app.main:app --reload --port 8000
```

### 2. Frontend

```bash
cd frontend

# Install dependencies
npm install

# Run dev server
npm run dev
```

### 3. Access

Open http://localhost:3000 in your browser.

## Configuration

### Backend Environment Variables

Create `backend/.env` from `.env.example`:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AZURE_VOICELIVE_ENDPOINT` | Yes | - | WebSocket endpoint (see formats below) |
| `AZURE_VOICELIVE_API_KEY` | Yes* | - | API key (*or use token credential) |
| `USE_TOKEN_CREDENTIAL` | No | `false` | Use DefaultAzureCredential instead of API key |
| `VOICELIVE_MODEL` | No | `gpt-4o-realtime-preview` | AI model |
| `AVATAR_CHARACTER` | No | `lisa` | Avatar character |
| `AVATAR_STYLE` | No | `casual-sitting` | Avatar style |
| `AVATAR_CUSTOMIZED` | No | `false` | Use customized avatar |
| `AVATAR_VIDEO_BITRATE` | No | `2000000` | Video bitrate (bps) |
| `VOICE_NAME` | No | `en-US-Ava:DragonHDLatestNeural` | TTS voice |
| `INPUT_LANGUAGES` | No | `en,zh,ms,ta` | Comma-separated language codes |
| `MAX_RESPONSE_TOKENS` | No | `100` | Max tokens per response |
| `ASSISTANT_INSTRUCTIONS` | No | *(default prompt)* | System instructions |

#### Endpoint Formats

**AI Foundry (recommended):**
```
AZURE_VOICELIVE_ENDPOINT=wss://<instance>.cognitiveservices.azure.com
```

**Regional Speech Services:**
```
AZURE_VOICELIVE_ENDPOINT=wss://<region>.voice.speech.microsoft.com
```

### Frontend Environment Variables

Create `frontend/.env.local`:

```
NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws/voice-avatar
```

## Architecture

### Data Flow

1. **Audio Input**: Browser captures microphone at 24kHz mono PCM16, base64-encodes, sends via WebSocket
2. **Processing**: Backend proxies to Azure VoiceLive which handles VAD, transcription (Whisper), and response generation
3. **Avatar Video**: Azure streams video/audio directly to browser via WebRTC (bypasses backend)
4. **Transcripts**: Both user and assistant speech transcribed and sent to frontend

### Backend Components

| File | Purpose |
|------|---------|
| `app/main.py` | FastAPI app with WebSocket endpoint `/ws/voice-avatar` |
| `app/voice_live.py` | `VoiceAvatarSession` class - Azure connection, SDP exchange, event handling |
| `app/config.py` | `Settings` class - environment configuration with validation |

### Frontend Components

| File | Purpose |
|------|---------|
| `hooks/useVoiceAvatar.ts` | Core hook - WebSocket, WebRTC, microphone capture, audio playback |
| `components/VoiceAvatar.tsx` | UI - video player, transcript panel, connection controls |

## WebSocket Protocol

### Client → Server

| Message | Description |
|---------|-------------|
| `{"type": "audio", "data": "<base64>"}` | PCM16 audio chunk from microphone |
| `{"type": "avatar.sdp", "sdp": "<sdp>"}` | WebRTC offer for avatar video |

### Server → Client

| Message | Description |
|---------|-------------|
| `{"type": "session.ready", "ice_servers": [...]}` | Session established, includes ICE servers for WebRTC |
| `{"type": "avatar.sdp", "server_sdp": "..."}` | WebRTC answer from Azure |
| `{"type": "avatar.connected"}` | Avatar WebRTC connection established |
| `{"type": "avatar.error", "message": "..."}` | Avatar failed (fallback to voice-only) |
| `{"type": "user.speaking.started"}` | VAD detected user speech |
| `{"type": "user.speaking.stopped"}` | VAD detected silence |
| `{"type": "transcript", "role": "user\|assistant", "text": "..."}` | Speech transcription |
| `{"type": "assistant.response.started"}` | AI started generating response |
| `{"type": "assistant.response.done"}` | AI response complete |
| `{"type": "assistant.response.cancelled"}` | Response cancelled (user interrupted) |
| `{"type": "audio.delta", "data": "<base64>"}` | Audio chunk (voice-only mode) |
| `{"type": "error", "message": "...", "code": "..."}` | Error event |

## Project Structure

```
voice-avatar/
├── backend/
│   ├── app/
│   │   ├── main.py           # FastAPI WebSocket endpoint
│   │   ├── voice_live.py     # VoiceLive + Avatar session handler
│   │   └── config.py         # Environment configuration
│   ├── pyproject.toml        # Python dependencies (uv)
│   └── .env.example          # Environment template
├── frontend/
│   ├── app/
│   │   ├── layout.tsx        # Root layout
│   │   └── page.tsx          # Home page
│   ├── components/
│   │   └── VoiceAvatar.tsx   # Main avatar UI component
│   ├── hooks/
│   │   └── useVoiceAvatar.ts # WebSocket + WebRTC logic
│   ├── package.json          # Node dependencies
│   └── .env.example          # Environment template
├── CLAUDE.md                 # Developer guide
└── README.md
```

## Avatar Configuration

### Standard Characters

| Character | Description |
|-----------|-------------|
| `lisa` | Female, casual appearance |
| `max` | Male, professional appearance |
| `jenny` | Female, professional appearance |
| `guy` | Male, casual appearance |

### Standard Styles

| Style | Description |
|-------|-------------|
| `casual-sitting` | Relaxed seated position |
| `graceful-sitting` | Elegant seated position |
| `technical-sitting` | Professional seated position |

### Video Settings

- Resolution: 1280x720 (fixed)
- Bitrate: Configurable via `AVATAR_VIDEO_BITRATE`
- Codec: H.264

See [Azure Avatar documentation](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/text-to-speech-avatar/what-is-text-to-speech-avatar) for full list.

## Troubleshooting

### `avatar_verification_failed`
Avatar character doesn't exist in your Speech resource region. Verify:
- Your resource is in an avatar-supported region
- Character name is correct (case-sensitive, e.g., `lisa` not `Lisa`)

### SDP/WebRTC Timeout
- Verify SDP is being sent as base64-encoded JSON
- Check browser console for WebRTC errors
- Ensure ICE servers are received in `session.ready`

### Silent Avatar Video
- Check that AudioContext is not suspended (user interaction required)
- Verify audio element has `autoPlay` attribute
- Check browser permissions for audio playback

### No ICE Servers in session.ready
Your Azure resource region may not support avatar. The app will fall back to voice-only mode automatically.

### Voice-only Mode Active
If avatar fails, audio is streamed via `audio.delta` WebSocket messages instead of WebRTC. This is expected behavior for unsupported regions.

## API Reference

### `GET /health`

Health check endpoint.

**Response:**
```json
{"status": "healthy"}
```

### `WebSocket /ws/voice-avatar`

Main voice avatar session endpoint. See [WebSocket Protocol](#websocket-protocol) for message formats.

**Connection Flow:**
1. Client connects
2. Server establishes VoiceLive connection
3. Server sends `session.ready` with ICE servers
4. Client sends WebRTC offer (`avatar.sdp`)
5. Server returns WebRTC answer
6. Client streams audio, receives events

## Development

### Backend Commands

```bash
cd backend
uv sync                                           # Install dependencies
uv run uvicorn app.main:app --reload --port 8000  # Dev server
uv run pytest                                     # Run tests
```

### Frontend Commands

```bash
cd frontend
npm install          # Install dependencies
npm run dev          # Dev server (localhost:3000)
npm run build        # Production build
npm run lint         # ESLint
```

## License

MIT
