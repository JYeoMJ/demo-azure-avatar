"""
Tests for VoiceAvatarSession class and Azure VoiceLive integration.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from app.voice_live import (
    VoiceAvatarSession,
    _encode_client_sdp,
    _decode_server_sdp,
    EXPECTED_ERROR_CODES,
)


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


class TestExpectedErrorFiltering:
    """Tests for expected error code filtering."""

    def test_expected_error_codes_defined(self):
        """Expected error codes set should contain known harmless errors."""
        assert "response_cancel_not_active" in EXPECTED_ERROR_CODES

    @pytest.mark.asyncio
    async def test_expected_error_filtered_not_forwarded(self):
        """Expected error codes should return None (not forwarded to client)."""
        session = VoiceAvatarSession()

        # Simulate error event with expected code
        mock_event = MagicMock()
        mock_event.type = "error"
        mock_event.error = MagicMock()
        mock_event.error.code = "response_cancel_not_active"
        mock_event.error.message = "Cancellation failed: no active response found."

        result = await session._handle_event(mock_event)

        # Expected errors should return None (filtered out)
        assert result is None

    @pytest.mark.asyncio
    async def test_unexpected_error_forwarded(self):
        """Unexpected error codes should still be forwarded to client."""
        session = VoiceAvatarSession()

        # Simulate error event with unexpected code
        mock_event = MagicMock()
        mock_event.type = "error"
        mock_event.error = MagicMock()
        mock_event.error.code = "some_real_error"
        mock_event.error.message = "Something actually went wrong."

        result = await session._handle_event(mock_event)

        # Unexpected errors should be forwarded
        assert result is not None
        assert result["type"] == "error"
        assert result["code"] == "some_real_error"
        assert result["message"] == "Something actually went wrong."


class TestSessionConfiguration:
    """Tests for session configuration building."""

    def test_build_session_config_video_avatar(self):
        """Session config should include video avatar settings."""
        with patch("app.voice_live.settings") as mock_settings:
            mock_settings.VOICE_NAME = "en-US-JennyNeural"
            mock_settings.TURN_BASED_MODE = False
            mock_settings.ASSISTANT_INSTRUCTIONS = "You are a helpful assistant."
            mock_settings.AVATAR_CHARACTER = "lisa"
            mock_settings.AVATAR_STYLE = "casual-sitting"
            mock_settings.AVATAR_CUSTOMIZED = False
            mock_settings.AVATAR_BASE_MODEL = None  # Video avatar
            mock_settings.AVATAR_VIDEO_BITRATE = 2000000
            mock_settings.INPUT_LANGUAGES = "en"
            mock_settings.MAX_RESPONSE_TOKENS = 4096

            session = VoiceAvatarSession()
            config = session._build_session_config()

            assert config.avatar["character"] == "lisa"
            assert config.avatar["style"] == "casual-sitting"
            assert config.avatar["type"] == "video-avatar"
            assert config.avatar["video"]["resolution"]["width"] == 1280
            assert config.avatar["video"]["resolution"]["height"] == 720

    def test_build_session_config_photo_avatar(self):
        """Session config should handle photo avatar settings."""
        with patch("app.voice_live.settings") as mock_settings:
            mock_settings.VOICE_NAME = "en-US-JennyNeural"
            mock_settings.TURN_BASED_MODE = False
            mock_settings.ASSISTANT_INSTRUCTIONS = "You are a helpful assistant."
            mock_settings.AVATAR_CHARACTER = "custom-photo"
            mock_settings.AVATAR_STYLE = None
            mock_settings.AVATAR_CUSTOMIZED = False
            mock_settings.AVATAR_BASE_MODEL = "vasa-1"  # Photo avatar
            mock_settings.AVATAR_VIDEO_BITRATE = 2000000
            mock_settings.INPUT_LANGUAGES = "en"
            mock_settings.MAX_RESPONSE_TOKENS = 4096

            session = VoiceAvatarSession()
            config = session._build_session_config()

            assert config.avatar["type"] == "photo-avatar"
            assert config.avatar["model"] == "vasa-1"
            assert (
                config.avatar["customized"] is True
            )  # Photo avatars need customized=true
            assert config.avatar["video"]["resolution"]["width"] == 512
            assert config.avatar["video"]["resolution"]["height"] == 512

    def test_build_session_config_turn_based_mode(self):
        """Turn-based mode should disable auto-response."""
        with patch("app.voice_live.settings") as mock_settings:
            mock_settings.VOICE_NAME = "en-US-JennyNeural"
            mock_settings.TURN_BASED_MODE = True
            mock_settings.ASSISTANT_INSTRUCTIONS = "You are a helpful assistant."
            mock_settings.AVATAR_CHARACTER = "lisa"
            mock_settings.AVATAR_STYLE = "casual-sitting"
            mock_settings.AVATAR_CUSTOMIZED = False
            mock_settings.AVATAR_BASE_MODEL = None
            mock_settings.AVATAR_VIDEO_BITRATE = 2000000
            mock_settings.INPUT_LANGUAGES = "en"
            mock_settings.MAX_RESPONSE_TOKENS = 4096

            session = VoiceAvatarSession()
            config = session._build_session_config()

            # Turn detection should have create_response=False in turn-based mode
            assert config.turn_detection.create_response is False
            assert config.turn_detection.silence_duration_ms == 800


class TestAvatarConnection:
    """Tests for avatar WebRTC connection flow."""

    @pytest.mark.asyncio
    async def test_connect_creates_foundry_thread_when_enabled(self):
        """Connect should create a Foundry Agent thread when enabled."""
        with (
            patch("app.voice_live.connect") as mock_connect,
            patch("app.voice_live.foundry_agent") as mock_foundry,
        ):
            # Setup mocks
            mock_connection = AsyncMock()
            mock_connection.session = AsyncMock()
            mock_cm = AsyncMock()
            mock_cm.__aenter__ = AsyncMock(return_value=mock_connection)
            mock_connect.return_value = mock_cm

            mock_foundry.enabled = True
            mock_foundry.initialize.return_value = True
            mock_foundry.create_thread.return_value = "thread_123"

            session = VoiceAvatarSession()
            result = await session.connect()

            assert result == {"status": "connecting"}
            mock_foundry.create_thread.assert_called_once()
            assert session._foundry_thread_id == "thread_123"

    @pytest.mark.asyncio
    async def test_connect_skips_foundry_thread_when_disabled(self):
        """Connect should skip Foundry thread creation when disabled."""
        with (
            patch("app.voice_live.connect") as mock_connect,
            patch("app.voice_live.foundry_agent") as mock_foundry,
        ):
            mock_connection = AsyncMock()
            mock_connection.session = AsyncMock()
            mock_cm = AsyncMock()
            mock_cm.__aenter__ = AsyncMock(return_value=mock_connection)
            mock_connect.return_value = mock_cm

            mock_foundry.enabled = False
            mock_foundry.initialize.return_value = False

            session = VoiceAvatarSession()
            await session.connect()

            mock_foundry.create_thread.assert_not_called()
            assert session._foundry_thread_id is None

    @pytest.mark.asyncio
    async def test_send_avatar_sdp_encodes_and_sends(self, mock_azure_connection):
        """send_avatar_sdp should encode SDP and send to VoiceLive."""
        session = VoiceAvatarSession()
        session.connection = mock_azure_connection

        client_sdp = "v=0\r\no=- 123 456 IN IP4 127.0.0.1"
        await session.send_avatar_sdp(client_sdp)

        mock_azure_connection.send.assert_called_once()
        call_args = mock_azure_connection.send.call_args[0][0]
        assert call_args["type"] == "session.avatar.connect"
        assert "client_sdp" in call_args
        assert call_args["rtc_configuration"]["bundle_policy"] == "max-bundle"

    @pytest.mark.asyncio
    async def test_send_avatar_sdp_no_connection(self):
        """send_avatar_sdp should handle missing connection gracefully."""
        session = VoiceAvatarSession()
        session.connection = None

        # Should not raise, just log error
        await session.send_avatar_sdp("v=0\r\no=- 123 456 IN IP4 127.0.0.1")


class TestAvatarEventHandling:
    """Tests for avatar-related event handling."""

    @pytest.mark.asyncio
    async def test_session_updated_extracts_ice_servers(self):
        """session.updated event should extract ICE servers."""
        session = VoiceAvatarSession()

        mock_event = MagicMock()
        mock_event.type = "session.updated"
        mock_event.session = MagicMock()
        mock_event.session.avatar = MagicMock()
        mock_event.session.avatar.ice_servers = [
            MagicMock(
                urls=["stun:stun.example.com:3478"],
                username="user1",
                credential="cred1",
            ),
            MagicMock(
                urls=["turn:turn.example.com:3478"],
                username="user2",
                credential="cred2",
            ),
        ]

        result = await session._handle_event(mock_event)

        assert result["type"] == "session.ready"
        assert len(result["ice_servers"]) == 2
        assert result["ice_servers"][0]["urls"] == ["stun:stun.example.com:3478"]
        assert result["ice_servers"][0]["username"] == "user1"
        assert session.session_ready is True
        assert len(session.avatar_ice_servers) == 2

    @pytest.mark.asyncio
    async def test_session_updated_no_ice_servers(self):
        """session.updated should handle missing ICE servers."""
        session = VoiceAvatarSession()

        mock_event = MagicMock()
        mock_event.type = "session.updated"
        mock_event.session = MagicMock()
        mock_event.session.avatar = None

        result = await session._handle_event(mock_event)

        assert result["type"] == "session.ready"
        assert result["ice_servers"] == []
        assert session.session_ready is True

    @pytest.mark.asyncio
    async def test_avatar_connecting_decodes_server_sdp(self):
        """session.avatar.connecting should decode server SDP."""
        import base64
        import json

        session = VoiceAvatarSession()

        # Simulate base64-encoded server SDP
        server_sdp = "v=0\r\no=- 789 012 IN IP4 192.168.1.1"
        encoded_sdp = base64.b64encode(
            json.dumps({"type": "answer", "sdp": server_sdp}).encode()
        ).decode()

        mock_event = MagicMock()
        mock_event.type = "session.avatar.connecting"
        mock_event.server_sdp = encoded_sdp

        result = await session._handle_event(mock_event)

        assert result["type"] == "avatar.sdp"
        assert result["server_sdp"] == server_sdp

    @pytest.mark.asyncio
    async def test_avatar_connected_event(self):
        """session.avatar.connected should return connected status."""
        session = VoiceAvatarSession()

        mock_event = MagicMock()
        mock_event.type = "session.avatar.connected"

        result = await session._handle_event(mock_event)

        assert result == {"type": "avatar.connected"}

    @pytest.mark.asyncio
    async def test_avatar_error_event(self):
        """session.avatar.error should return error info."""
        session = VoiceAvatarSession()

        mock_event = MagicMock()
        mock_event.type = "session.avatar.error"
        mock_event.error = "Avatar region not supported"

        result = await session._handle_event(mock_event)

        assert result["type"] == "avatar.error"
        assert result["message"] == "Avatar region not supported"

    @pytest.mark.asyncio
    async def test_avatar_failed_event(self):
        """session.avatar.failed should return error info."""
        session = VoiceAvatarSession()

        mock_event = MagicMock(spec=["type", "message"])  # Only these attributes
        mock_event.type = "session.avatar.failed"
        mock_event.message = "WebRTC connection failed"

        result = await session._handle_event(mock_event)

        assert result["type"] == "avatar.error"
        assert result["message"] == "WebRTC connection failed"


class TestFoundryThreadManagement:
    """Tests for Foundry Agent thread lifecycle management."""

    def test_init_foundry_attributes(self):
        """Session should initialize Foundry thread attributes."""
        session = VoiceAvatarSession()

        assert session._foundry_thread_id is None
        assert session._recent_user_messages == []

    @pytest.mark.asyncio
    async def test_disconnect_deletes_foundry_thread(self):
        """Disconnect should delete Foundry thread and clear messages."""
        with patch("app.voice_live.foundry_agent") as mock_foundry:
            session = VoiceAvatarSession()
            session._foundry_thread_id = "thread_456"
            session._recent_user_messages = ["msg1", "msg2"]

            await session.disconnect()

            mock_foundry.delete_thread.assert_called_once_with("thread_456")
            assert session._foundry_thread_id is None
            assert session._recent_user_messages == []

    @pytest.mark.asyncio
    async def test_disconnect_handles_thread_deletion_failure(self):
        """Disconnect should handle thread deletion failure gracefully."""
        with patch("app.voice_live.foundry_agent") as mock_foundry:
            mock_foundry.delete_thread.side_effect = Exception("API error")

            session = VoiceAvatarSession()
            session._foundry_thread_id = "thread_789"

            # Should not raise
            await session.disconnect()

            # Thread ID should still be cleared
            assert session._foundry_thread_id is None


class TestUserMessageTracking:
    """Tests for user message tracking for conversation context."""

    @pytest.mark.asyncio
    async def test_transcription_tracks_user_message(self):
        """User transcription should be tracked for context."""
        session = VoiceAvatarSession()

        mock_event = MagicMock()
        mock_event.type = "conversation.item.input_audio_transcription.completed"
        mock_event.transcript = "What is Company X?"

        await session._handle_event(mock_event)

        assert "What is Company X?" in session._recent_user_messages

    @pytest.mark.asyncio
    async def test_message_tracking_limits_to_three(self):
        """Only last 3 messages should be tracked."""
        session = VoiceAvatarSession()

        # Add 4 messages via transcription events
        for i, msg in enumerate(["msg1", "msg2", "msg3", "msg4"]):
            mock_event = MagicMock()
            mock_event.type = "conversation.item.input_audio_transcription.completed"
            mock_event.transcript = msg
            await session._handle_event(mock_event)

        assert len(session._recent_user_messages) == 3
        assert session._recent_user_messages == ["msg2", "msg3", "msg4"]

    @pytest.mark.asyncio
    async def test_text_input_tracks_message(self, mock_azure_connection):
        """Text input should also track messages."""
        with patch("app.voice_live.foundry_agent") as mock_foundry:
            mock_foundry.enabled = False

            session = VoiceAvatarSession()
            session.connection = mock_azure_connection
            session.session_ready = True

            await session.send_text_input("Hello from text input")

            assert "Hello from text input" in session._recent_user_messages

    @pytest.mark.asyncio
    async def test_empty_transcript_not_tracked(self):
        """Empty or whitespace transcripts should not be tracked."""
        session = VoiceAvatarSession()

        for transcript in [None, "", "   "]:
            mock_event = MagicMock()
            mock_event.type = "conversation.item.input_audio_transcription.completed"
            mock_event.transcript = transcript
            await session._handle_event(mock_event)

        assert session._recent_user_messages == []


class TestRAGContextInjection:
    """Tests for RAG context injection with conversation history."""

    @pytest.mark.asyncio
    async def test_context_injection_passes_thread_id(self, mock_azure_connection):
        """RAG context injection should pass thread_id to get_context."""
        with patch("app.voice_live.foundry_agent") as mock_foundry:
            mock_foundry.enabled = True
            mock_foundry.get_context.return_value = "Relevant context here"

            session = VoiceAvatarSession()
            session.connection = mock_azure_connection
            session.session_ready = True
            session._foundry_thread_id = "thread_999"
            session._recent_user_messages = ["Previous question", "Current question"]

            await session._inject_rag_context_background("Current question")

            # Verify get_context was called with thread_id and conversation_context
            mock_foundry.get_context.assert_called_once()
            call_kwargs = mock_foundry.get_context.call_args
            assert call_kwargs[0][0] == "Current question"  # query
            assert call_kwargs[1]["thread_id"] == "thread_999"
            assert call_kwargs[1]["conversation_context"] == ["Previous question"]

    @pytest.mark.asyncio
    async def test_context_injection_excludes_current_query(
        self, mock_azure_connection
    ):
        """Conversation context should exclude current query (last message)."""
        with patch("app.voice_live.foundry_agent") as mock_foundry:
            mock_foundry.enabled = True
            mock_foundry.get_context.return_value = "Context"

            session = VoiceAvatarSession()
            session.connection = mock_azure_connection
            session.session_ready = True
            session._foundry_thread_id = "thread_abc"
            session._recent_user_messages = ["Q1", "Q2", "Q3"]

            await session._inject_rag_context_background("Q3")

            call_kwargs = mock_foundry.get_context.call_args
            # Should include Q1, Q2 but not Q3 (current query)
            assert call_kwargs[1]["conversation_context"] == ["Q1", "Q2"]

    @pytest.mark.asyncio
    async def test_context_injection_no_history(self, mock_azure_connection):
        """Context injection should work with no previous messages."""
        with patch("app.voice_live.foundry_agent") as mock_foundry:
            mock_foundry.enabled = True
            mock_foundry.get_context.return_value = "Context"

            session = VoiceAvatarSession()
            session.connection = mock_azure_connection
            session.session_ready = True
            session._foundry_thread_id = "thread_xyz"
            session._recent_user_messages = ["Only message"]

            await session._inject_rag_context_background("Only message")

            call_kwargs = mock_foundry.get_context.call_args
            # No previous messages, conversation_context should be None
            assert call_kwargs[1]["conversation_context"] is None
