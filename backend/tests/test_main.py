"""
Tests for FastAPI WebSocket endpoint and input validation.
"""

import base64
from app.main import (
    validate_base64_data,
    RateLimiter,
    MAX_AUDIO_CHUNK_SIZE,
    MAX_SDP_SIZE,
)


class TestValidateBase64Data:
    """Tests for base64 data validation."""

    def test_valid_base64(self):
        """Valid base64 data should pass validation."""
        valid_data = base64.b64encode(b"test audio data").decode("ascii")
        is_valid, error = validate_base64_data(valid_data, MAX_AUDIO_CHUNK_SIZE)
        assert is_valid is True
        assert error is None

    def test_empty_data(self):
        """Empty data should fail validation."""
        is_valid, error = validate_base64_data("", MAX_AUDIO_CHUNK_SIZE)
        assert is_valid is False
        assert "Empty data" in error

    def test_oversized_data(self):
        """Data exceeding max size should fail validation."""
        large_data = "A" * (MAX_AUDIO_CHUNK_SIZE + 1)
        is_valid, error = validate_base64_data(large_data, MAX_AUDIO_CHUNK_SIZE)
        assert is_valid is False
        assert "exceeds maximum size" in error

    def test_invalid_base64(self):
        """Invalid base64 encoding should fail validation."""
        invalid_data = "not-valid-base64!!!"
        is_valid, error = validate_base64_data(invalid_data, MAX_AUDIO_CHUNK_SIZE)
        assert is_valid is False
        assert "Invalid base64" in error

    def test_sdp_size_limit(self):
        """SDP should respect its own size limit."""
        large_sdp = "v=0" + "A" * MAX_SDP_SIZE
        is_valid, error = validate_base64_data(large_sdp, MAX_SDP_SIZE)
        assert is_valid is False


class TestRateLimiter:
    """Tests for rate limiting."""

    def test_allows_under_limit(self):
        """Should allow messages under the rate limit."""
        limiter = RateLimiter(max_messages=10, window_seconds=1.0)
        for _ in range(10):
            assert limiter.allow() is True

    def test_blocks_over_limit(self):
        """Should block messages over the rate limit."""
        limiter = RateLimiter(max_messages=5, window_seconds=1.0)
        for _ in range(5):
            limiter.allow()
        assert limiter.allow() is False

    def test_window_expiry(self):
        """Messages should be allowed again after window expires."""
        import time

        limiter = RateLimiter(max_messages=2, window_seconds=0.1)
        limiter.allow()
        limiter.allow()
        assert limiter.allow() is False
        time.sleep(0.15)  # Wait for window to expire
        assert limiter.allow() is True


class TestHealthEndpoint:
    """Tests for health check endpoint."""

    def test_health_check(self, client):
        """Health endpoint should return healthy status."""
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "healthy"}
