"""
Azure AI Foundry Agent Service

Provides RAG-augmented responses using Azure AI Foundry Agents with file_search tool.
Supports both full agent processing (for text chat) and retrieval-only (for live voice).
"""

import logging
from typing import Optional, Any

from azure.ai.agents import AgentsClient
from azure.ai.agents.models import ListSortOrder
from azure.identity import DefaultAzureCredential

from .config import settings

logger = logging.getLogger(__name__)


class FoundryAgentService:
    """
    Manages Azure AI Foundry Agent for RAG-augmented conversations.

    Uses AgentsClient to interact with a pre-configured agent
    that has file_search tool for knowledge retrieval.
    """

    def __init__(self):
        self._client: Optional[AgentsClient] = None
        self._agent: Any = None  # Agent object from get_agent()
        self._initialized = False

    @property
    def enabled(self) -> bool:
        """Check if Foundry Agent is enabled and initialized."""
        return settings.FOUNDRY_AGENT_ENABLED and self._initialized

    @property
    def agent_id(self) -> Optional[str]:
        """Get the current agent ID."""
        return self._agent.id if self._agent else None

    def initialize(self) -> bool:
        """
        Initialize the Foundry Agent service.

        Requires FOUNDRY_ENDPOINT and FOUNDRY_AGENT_ID to be set.

        Returns:
            True if initialization successful, False otherwise
        """
        if self._initialized:
            return True

        if not settings.FOUNDRY_AGENT_ENABLED:
            logger.info("Foundry Agent is disabled")
            return False

        if not settings.FOUNDRY_ENDPOINT:
            logger.warning("Foundry Agent enabled but FOUNDRY_ENDPOINT not set")
            return False

        if not settings.FOUNDRY_AGENT_ID:
            logger.warning("Foundry Agent enabled but FOUNDRY_AGENT_ID not set")
            return False

        try:
            logger.info(f"Connecting to Foundry at {settings.FOUNDRY_ENDPOINT}")

            # Create AgentsClient with DefaultAzureCredential
            # Endpoint must be the full project URL:
            # https://<instance>.services.ai.azure.com/api/projects/<project>
            self._client = AgentsClient(
                endpoint=settings.FOUNDRY_ENDPOINT,
                credential=DefaultAzureCredential(),
            )

            # Fetch the agent object
            self._agent = self._client.get_agent(settings.FOUNDRY_AGENT_ID)
            logger.info(f"Using Foundry Agent: {self._agent.id}")

            self._initialized = True
            logger.info("Foundry Agent service initialized successfully")
            return True

        except Exception as e:
            logger.error(f"Failed to initialize Foundry Agent: {e}")
            return False

    def process_query(self, query: str) -> Optional[str]:
        """
        Process a query through the Foundry Agent (full RAG + LLM).

        This is used for text chat mode where the agent provides
        the complete response.

        Args:
            query: User's question or message

        Returns:
            Agent's response text, or None if failed
        """
        if not self._client or not self._agent:
            logger.warning("Cannot process query: agent not initialized")
            return None

        thread = None
        try:
            # Create a new thread
            thread = self._client.threads.create()
            logger.debug(f"Created thread: {thread.id}")

            # Add user message
            self._client.messages.create(
                thread_id=thread.id,
                role="user",
                content=query
            )

            # Run the agent
            run = self._client.runs.create_and_process(
                thread_id=thread.id,
                agent_id=self._agent.id
            )

            if run.status == "failed":
                logger.error(f"Agent run failed: {run.last_error}")
                return None

            # Get the messages
            messages = self._client.messages.list(
                thread_id=thread.id,
                order=ListSortOrder.ASCENDING
            )

            # Find the assistant's response (last assistant message)
            for msg in messages:
                if msg.role == "assistant" and msg.text_messages:
                    response_text = msg.text_messages[-1].text.value
                    logger.info(f"Agent response: {response_text[:100]}...")
                    return response_text

            logger.warning("No assistant response found")
            return None

        except Exception as e:
            logger.error(f"Error processing query: {e}")
            return None
        finally:
            # Always delete the thread to prevent resource accumulation
            if thread and self._client:
                try:
                    self._client.threads.delete(thread.id)
                    logger.debug(f"Deleted thread: {thread.id}")
                except Exception as e:
                    logger.warning(f"Failed to delete thread {thread.id}: {e}")

    def get_context(self, query: str) -> Optional[str]:
        """
        Retrieve relevant context from the knowledge base.

        This is used for live voice mode where we need context
        to inject into VoiceLive's system prompt, but VoiceLive
        generates the actual response.

        Args:
            query: User's question or message

        Returns:
            Formatted context string, or None if no relevant context
        """
        if not self._client or not self._agent:
            return None

        thread = None
        try:
            # Use the agent to search and return context
            context_query = f"Based on the knowledge base, what information is relevant to this question (provide key facts only, no full answer): {query}"

            thread = self._client.threads.create()
            self._client.messages.create(
                thread_id=thread.id,
                role="user",
                content=context_query
            )

            run = self._client.runs.create_and_process(
                thread_id=thread.id,
                agent_id=self._agent.id
            )

            if run.status == "failed":
                logger.error(f"Context retrieval failed: {run.last_error}")
                return None

            messages = self._client.messages.list(
                thread_id=thread.id,
                order=ListSortOrder.ASCENDING
            )

            for msg in messages:
                if msg.role == "assistant" and msg.text_messages:
                    context = msg.text_messages[-1].text.value
                    logger.info(f"Retrieved context: {context[:100]}...")
                    return f"Relevant information from knowledge base:\n{context}"

            return None

        except Exception as e:
            logger.error(f"Error getting context: {e}")
            return None
        finally:
            # Always delete the thread to prevent resource accumulation
            if thread and self._client:
                try:
                    self._client.threads.delete(thread.id)
                    logger.debug(f"Deleted thread: {thread.id}")
                except Exception as e:
                    logger.warning(f"Failed to delete thread {thread.id}: {e}")

    def cleanup(self) -> None:
        """Clean up resources (call on shutdown if needed)."""
        logger.info("Foundry Agent service cleanup complete")


# Global instance
foundry_agent = FoundryAgentService()
