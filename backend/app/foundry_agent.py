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

    def create_thread(self) -> Optional[str]:
        """
        Create a new thread and return its ID.

        Use this to create a session-scoped thread that persists
        across multiple queries for conversation context.

        Returns:
            Thread ID if successful, None otherwise
        """
        if not self._client:
            logger.warning("Cannot create thread: client not initialized")
            return None

        try:
            thread = self._client.threads.create()
            logger.info(f"Created session thread: {thread.id}")
            return thread.id
        except Exception as e:
            logger.error(f"Failed to create thread: {e}")
            return None

    def delete_thread(self, thread_id: str) -> None:
        """
        Delete a thread by ID.

        Call this when a session ends to clean up resources.

        Args:
            thread_id: The thread ID to delete
        """
        if not self._client:
            logger.warning("Cannot delete thread: client not initialized")
            return

        try:
            self._client.threads.delete(thread_id)
            logger.info(f"Deleted session thread: {thread_id}")
        except Exception as e:
            logger.warning(f"Failed to delete thread {thread_id}: {e}")

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

    def get_context(
        self,
        query: str,
        thread_id: Optional[str] = None,
        conversation_context: Optional[list[str]] = None,
    ) -> Optional[str]:
        """
        Retrieve relevant context from the knowledge base.

        This is used for live voice mode where we need context
        to inject into VoiceLive's system prompt, but VoiceLive
        generates the actual response.

        Args:
            query: User's question or message
            thread_id: Optional existing thread ID to reuse (session-based mode).
                      If provided, the thread is reused and NOT deleted after the call.
                      If not provided, a new thread is created and deleted (stateless mode).
            conversation_context: Optional list of recent user messages to prepend
                      to the query for better retrieval context.

        Returns:
            Formatted context string, or None if no relevant context
        """
        if not self._client or not self._agent:
            return None

        # Determine if we're in session-based or stateless mode
        session_based = thread_id is not None
        local_thread = None

        try:
            # Build context-aware query if conversation context provided
            if conversation_context:
                context_prefix = "Previous conversation context:\n"
                context_prefix += "\n".join(f"- {msg}" for msg in conversation_context)
                context_prefix += f"\n\nCurrent question: {query}"
                context_query = f"Based on the knowledge base, what information is relevant to this question (provide key facts only, no full answer): {context_prefix}"
            else:
                context_query = f"Based on the knowledge base, what information is relevant to this question (provide key facts only, no full answer): {query}"

            # Use existing thread or create new one
            if session_based:
                active_thread_id = thread_id
            else:
                local_thread = self._client.threads.create()
                active_thread_id = local_thread.id

            self._client.messages.create(
                thread_id=active_thread_id,
                role="user",
                content=context_query
            )

            run = self._client.runs.create_and_process(
                thread_id=active_thread_id,
                agent_id=self._agent.id
            )

            if run.status == "failed":
                logger.error(f"Context retrieval failed: {run.last_error}")
                return None

            messages = self._client.messages.list(
                thread_id=active_thread_id,
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
            # Only delete thread if we created it (stateless mode)
            if local_thread and self._client:
                try:
                    self._client.threads.delete(local_thread.id)
                    logger.debug(f"Deleted thread: {local_thread.id}")
                except Exception as e:
                    logger.warning(f"Failed to delete thread {local_thread.id}: {e}")

    def cleanup(self) -> None:
        """Clean up resources (call on shutdown if needed)."""
        logger.info("Foundry Agent service cleanup complete")


# Global instance
foundry_agent = FoundryAgentService()
