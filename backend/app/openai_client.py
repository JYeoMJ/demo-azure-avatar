"""Azure OpenAI client for chat completions."""

import os
import logging
from typing import Optional

import aiohttp

logger = logging.getLogger(__name__)


class OpenAIClientWrapper:
    """Wrapper for Azure OpenAI chat completion API."""

    def __init__(self):
        self.endpoint = os.getenv("AZURE_OAI_ENDPOINT", "")
        self.key = os.getenv("AZURE_OAI_KEY", "")
        self.deployment = os.getenv("AZURE_OAI_DEPLOYMENT", "gpt-4o-mini")
        self.api_version = os.getenv("AZURE_OAI_API_VERSION", "2024-12-01-preview")

    def _validate_config(self):
        """Validate configuration is complete."""
        if not all([self.endpoint, self.key, self.deployment]):
            raise ValueError(
                "Azure OpenAI config incomplete (AZURE_OAI_ENDPOINT/KEY/DEPLOYMENT)"
            )

    async def get_chat_completion(
        self,
        messages: list[dict],
        temperature: float = 0.2,
        max_tokens: int = 500,
        req_id: str = "noid"
    ) -> str:
        """
        Get a chat completion from Azure OpenAI.

        Args:
            messages: List of message dicts with 'role' and 'content'
            temperature: Sampling temperature (lower = more deterministic)
            max_tokens: Maximum tokens in response
            req_id: Request ID for logging

        Returns:
            The assistant's response text
        """
        self._validate_config()

        url = (
            f"{self.endpoint.rstrip('/')}"
            f"/openai/deployments/{self.deployment}"
            f"/chat/completions?api-version={self.api_version}"
        )

        payload = {
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }

        logger.info(f"[OAI:{req_id}] Calling chat completion with {len(messages)} messages")

        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                headers={
                    "Content-Type": "application/json",
                    "api-key": self.key,
                },
                json=payload,
                timeout=aiohttp.ClientTimeout(total=60)
            ) as response:
                if not response.ok:
                    body = await response.text()
                    logger.error(f"[OAI:{req_id}] Chat completion failed: {response.status} {body}")
                    raise RuntimeError(f"Chat completion failed: {response.status} {body}")

                data = await response.json()

                # Extract response content
                choices = data.get("choices", [])
                if not choices:
                    raise RuntimeError("No choices in response")

                message = choices[0].get("message", {})
                content = message.get("content", "")

                # Log token usage
                usage = data.get("usage", {})
                logger.info(
                    f"[OAI:{req_id}] Tokens: prompt={usage.get('prompt_tokens', 0)}, "
                    f"completion={usage.get('completion_tokens', 0)}"
                )

                return content.strip()


# Module-level instance
_openai_client: Optional[OpenAIClientWrapper] = None


def get_openai_client() -> OpenAIClientWrapper:
    """Get the singleton OpenAI client instance."""
    global _openai_client
    if _openai_client is None:
        _openai_client = OpenAIClientWrapper()
    return _openai_client


async def get_chat_completion(
    messages: list[dict],
    temperature: float = 0.2,
    max_tokens: int = 500,
    req_id: str = "noid"
) -> str:
    """Convenience function to get chat completion."""
    client = get_openai_client()
    return await client.get_chat_completion(messages, temperature, max_tokens, req_id)
