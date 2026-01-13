"""
Tests for VoiceAvatarSession class and Azure VoiceLive integration.
"""

import pytest
from unittest.mock import AsyncMock, patch
from app.voice_live import VoiceAvatarSession, _encode_client_sdp, _decode_server_sdp


class TestSdpEncoding:
    """Tests for SDP encoding/decoding utilities."""

    def test_encode_client_sdp(self):
        """Client SDP should be encoded as base64 JSON."""
        sdp = "v=0\r\no=- 123 456 IN IP4 127.0.0.1"
        encoded = _encode_client_sdp(sdp)
        assert encoded is not None
        assert len(encoded) > 0
        # Should be valid base64
        import base64
        decoded = base64.b64decode(encoded).decode("utf-8")
        import json
        payload = json.loads(decoded)
        assert payload["type"] == "offer"
        assert payload["sdp"] == sdp

    def test_decode_plain_sdp(self):
        """Plain SDP starting with v=0 should be returned as-is."""
        plain_sdp = "v=0\r\no=- 123 456 IN IP4 127.0.0.1"
        result = _decode_server_sdp(plain_sdp)
        assert result == plain_sdp

    def test_decode_base64_sdp(self):
        """Base64 encoded SDP JSON should be decoded."""
        import base64
        import json
        sdp = "v=0\r\no=- 123 456 IN IP4 127.0.0.1"
        payload = json.dumps({"type": "answer", "sdp": sdp})
        encoded = base64.b64encode(payload.encode("utf-8")).decode("ascii")
        result = _decode_server_sdp(encoded)
        assert result == sdp

    def test_decode_none_sdp(self):
        """None SDP should return None."""
        result = _decode_server_sdp(None)
        assert result is None

    def test_decode_invalid_base64(self):
        """Invalid base64 should return original string."""
        invalid = "not-valid-base64"
        result = _decode_server_sdp(invalid)
        assert result == invalid


class TestVoiceAvatarSession:
    """Tests for VoiceAvatarSession class."""

    def test_init_state(self):
        """Session should initialize with correct default state."""
        session = VoiceAvatarSession()
        assert session.connection is None
        assert session.session_ready is False
        assert session._response_in_progress is False
        assert session.avatar_ice_servers == []

    @pytest.mark.asyncio
    async def test_send_audio_when_ready(self, mock_azure_connection):
        """Audio should be sent when session is ready."""
        session = VoiceAvatarSession()
        session.connection = mock_azure_connection
        session.session_ready = True

        result = await session.send_audio("dGVzdCBhdWRpbw==")

        assert result is True
        mock_azure_connection.input_audio_buffer.append.assert_called_once()

    @pytest.mark.asyncio
    async def test_send_audio_when_not_ready(self, mock_azure_connection):
        """Audio should be dropped when session is not ready."""
        session = VoiceAvatarSession()
        session.connection = mock_azure_connection
        session.session_ready = False

        result = await session.send_audio("dGVzdCBhdWRpbw==")

        assert result is False
        mock_azure_connection.input_audio_buffer.append.assert_not_called()

    @pytest.mark.asyncio
    async def test_disconnect_cleans_up(self, mock_azure_connection):
        """Disconnect should clean up connection state."""
        session = VoiceAvatarSession()
        session.connection = mock_azure_connection
        session.session_ready = True

        await session.disconnect()

        assert session.connection is None
        assert session.session_ready is False
        mock_azure_connection.close.assert_called_once()


class TestInterruptionHandling:
    """Tests for user interruption handling."""

    @pytest.mark.asyncio
    async def test_interruption_resets_flag_on_success(self, mock_azure_connection):
        """Response in progress flag should reset after successful cancel."""
        session = VoiceAvatarSession()
        session.connection = mock_azure_connection
        session._response_in_progress = True

        # Simulate handling speech_started event
        mock_event = AsyncMock()
        mock_event.type = "input_audio_buffer.speech_started"

        result = await session._handle_event(mock_event)

        # Flag should be reset even if cancel succeeds
        assert session._response_in_progress is False
        assert result == {"type": "user.speaking.started"}

    @pytest.mark.asyncio
    async def test_interruption_resets_flag_on_cancel_failure(
        self, mock_azure_connection
    ):
        """Response in progress flag should reset even if cancel fails."""
        session = VoiceAvatarSession()
        session.connection = mock_azure_connection
        session._response_in_progress = True
        mock_azure_connection.response.cancel.side_effect = Exception("Cancel failed")

        mock_event = AsyncMock()
        mock_event.type = "input_audio_buffer.speech_started"

        result = await session._handle_event(mock_event)

        # Flag should still be reset due to try/finally
        assert session._response_in_progress is False
        assert result == {"type": "user.speaking.started"}
