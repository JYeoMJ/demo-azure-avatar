"""
RAG (Retrieval-Augmented Generation) module using Azure AI Search.

Provides document retrieval functionality to augment assistant responses
with relevant context from a knowledge base.
"""

import logging
from typing import Optional

from azure.core.credentials import AzureKeyCredential
from azure.search.documents import SearchClient

from .config import settings

logger = logging.getLogger(__name__)


class RAGRetriever:
    """
    Retrieves relevant documents from Azure AI Search for context augmentation.

    This class manages the connection to Azure AI Search and provides
    methods to retrieve and format relevant documents based on user queries.
    """

    def __init__(self):
        self._client: Optional[SearchClient] = None
        self._initialized = False

    @property
    def enabled(self) -> bool:
        """Check if RAG is enabled and properly configured."""
        return settings.RAG_ENABLED and self._initialized

    def initialize(self) -> bool:
        """
        Initialize the Azure Search client.

        Returns:
            True if initialization successful, False otherwise
        """
        if not settings.RAG_ENABLED:
            logger.info("RAG is disabled")
            return False

        if not all([
            settings.AZURE_SEARCH_ENDPOINT,
            settings.AZURE_SEARCH_API_KEY,
            settings.AZURE_SEARCH_INDEX
        ]):
            logger.warning("RAG enabled but missing Azure Search configuration")
            logger.warning(f"  Endpoint: {'set' if settings.AZURE_SEARCH_ENDPOINT else 'MISSING'}")
            logger.warning(f"  API Key: {'set' if settings.AZURE_SEARCH_API_KEY else 'MISSING'}")
            logger.warning(f"  Index: {'set' if settings.AZURE_SEARCH_INDEX else 'MISSING'}")
            return False

        try:
            credential = AzureKeyCredential(settings.AZURE_SEARCH_API_KEY)
            self._client = SearchClient(
                endpoint=settings.AZURE_SEARCH_ENDPOINT,
                index_name=settings.AZURE_SEARCH_INDEX,
                credential=credential
            )
            self._initialized = True
            logger.info(f"RAG initialized with index: {settings.AZURE_SEARCH_INDEX}")
            return True
        except Exception as e:
            logger.error(f"Failed to initialize RAG: {e}")
            return False

    def retrieve(self, query: str, top_k: Optional[int] = None) -> list[dict]:
        """
        Retrieve relevant documents for the given query.

        Args:
            query: The search query (typically user's transcribed speech)
            top_k: Number of documents to retrieve (defaults to RAG_TOP_K setting)

        Returns:
            List of dicts with 'content', 'title', and 'score' keys
        """
        if not self._client or not self._initialized:
            return []

        if not query or not query.strip():
            return []

        try:
            k = top_k or settings.RAG_TOP_K
            results = self._client.search(
                search_text=query,
                top=k,
                select=["content", "title"],  # Adjust field names as needed
            )

            documents = []
            for result in results:
                doc = {
                    "content": result.get("content", ""),
                    "title": result.get("title", ""),
                    "score": result.get("@search.score", 0)
                }
                # Only include documents with content
                if doc["content"]:
                    documents.append(doc)

            logger.info(f"RAG retrieved {len(documents)} documents for query: {query[:50]}...")
            return documents

        except Exception as e:
            logger.error(f"RAG retrieval error: {e}")
            return []

    def format_context(self, documents: list[dict], max_length: int = 1000) -> str:
        """
        Format retrieved documents as context string for instruction injection.

        Args:
            documents: List of document dicts from retrieve()
            max_length: Maximum total length of formatted context

        Returns:
            Formatted context string, or empty string if no documents
        """
        if not documents:
            return ""

        context_parts = ["Use the following information to help answer the question:"]
        total_length = len(context_parts[0])

        for i, doc in enumerate(documents, 1):
            title = doc.get("title", f"Document {i}")
            content = doc.get("content", "")

            # Truncate content if needed
            available = max_length - total_length - 50  # Reserve space for formatting
            if available <= 0:
                break

            if len(content) > available:
                content = content[:available] + "..."

            part = f"\n\n[{title}]\n{content}"
            context_parts.append(part)
            total_length += len(part)

        return "".join(context_parts)


# Global RAG instance for the application
rag_retriever = RAGRetriever()
