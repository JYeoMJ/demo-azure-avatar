"""
Pytest configuration and fixtures for voice avatar backend tests.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    """Create a test client for the FastAPI app."""
    return TestClient(app)


@pytest.fixture
def mock_azure_connection():
    """Create a mock Azure VoiceLive connection."""
    connection = AsyncMock()
    connection.input_audio_buffer = AsyncMock()
    connection.input_audio_buffer.append = AsyncMock()
    connection.response = AsyncMock()
    connection.response.cancel = AsyncMock()
    connection.session = AsyncMock()
    connection.session.update = AsyncMock()
    connection.close = AsyncMock()
    return connection


@pytest.fixture
def mock_voice_avatar_session(mock_azure_connection):
    """Create a mock VoiceAvatarSession with pre-configured connection."""
    with patch("app.main.VoiceAvatarSession") as MockSession:
        session_instance = AsyncMock()
        session_instance.connection = mock_azure_connection
        session_instance.session_ready = True
        session_instance._response_in_progress = False
        session_instance.connect = AsyncMock()
        session_instance.disconnect = AsyncMock()
        session_instance.send_audio = AsyncMock(return_value=True)
        session_instance.send_avatar_sdp = AsyncMock()
        session_instance.process_events = AsyncMock(return_value=iter([]))
        MockSession.return_value = session_instance
        yield session_instance
