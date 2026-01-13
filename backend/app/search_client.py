"""Azure AI Search client for RAG retrieval."""

import os
import logging
from typing import Optional

import aiohttp
from azure.search.documents.aio import SearchClient
from azure.core.credentials import AzureKeyCredential

logger = logging.getLogger(__name__)

# FAQ trigger keywords - queries containing these prioritize FAQ documents
FAQ_TRIGGER_KEYWORDS = [
    # Project submission
    "submit project", "project request", "submit a project", "project submission",
    "how to submit", "where to submit", "submission form", "request form",
    "propose", "proposal", "new project",
    # Tools access
    "bot-nuhs", "russell gpt", "russellgpt", "microsoft copilot", "co-pilot",
    "access tools", "how to access", "get access", "use the tools",
    # Prompts and training
    "prompts", "prompt library", "find prompts", "training", "training sessions",
    "learn about", "how to use",
    # General FAQ patterns
    "faq", "frequently asked", "questions about", "how do i", "how can i",
    "what is", "where can i", "who can", "when can",
    # Approvals
    "hod approval", "approval", "supervisor", "department head",
    # Digital Think Tank specific
    "digital think tank", "dtt", "data analytics", "automation", "ai tools",
]


def is_faq_query(query: str) -> bool:
    """Check if query matches FAQ patterns."""
    lower_query = (query or "").lower()
    return any(keyword in lower_query for keyword in FAQ_TRIGGER_KEYWORDS)


class SearchClientWrapper:
    """Wrapper for Azure AI Search with vector and lexical search capabilities."""

    def __init__(self):
        self.endpoint = os.getenv("AZURE_SEARCH_ENDPOINT", "")
        self.key = os.getenv("AZURE_SEARCH_KEY", "")
        self.index_name = os.getenv("AZURE_SEARCH_INDEX_NAME", "")
        self.vector_field = os.getenv("AZURE_SEARCH_VECTOR_FIELD", "text_vector")

        # Azure OpenAI for embeddings
        self.oai_endpoint = os.getenv("AZURE_OAI_ENDPOINT", "")
        self.oai_key = os.getenv("AZURE_OAI_KEY", "")
        self.oai_embedding_deployment = os.getenv("AZURE_OAI_EMBEDDING_DEPLOYMENT", "")
        self.oai_api_version = os.getenv("AZURE_OAI_API_VERSION", "2024-02-15-preview")

        self._client: Optional[SearchClient] = None

    def _get_client(self) -> SearchClient:
        """Get or create the search client."""
        if self._client is None:
            if not all([self.endpoint, self.key, self.index_name]):
                raise ValueError("Azure Search config incomplete (AZURE_SEARCH_ENDPOINT/KEY/INDEX_NAME)")
            self._client = SearchClient(
                endpoint=self.endpoint,
                index_name=self.index_name,
                credential=AzureKeyCredential(self.key)
            )
        return self._client

    def _has_embedding_config(self) -> bool:
        """Check if embedding configuration is available."""
        return bool(self.oai_endpoint and self.oai_key and self.oai_embedding_deployment)

    async def embed_text(self, text: str) -> list[float]:
        """Generate embeddings using Azure OpenAI."""
        if not self._has_embedding_config():
            raise ValueError("Missing Azure OpenAI embedding config")

        input_text = (text or "").strip()
        if not input_text:
            return []

        url = (
            f"{self.oai_endpoint.rstrip('/')}"
            f"/openai/deployments/{self.oai_embedding_deployment}"
            f"/embeddings?api-version={self.oai_api_version}"
        )

        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                headers={
                    "Content-Type": "application/json",
                    "api-key": self.oai_key,
                },
                json={"input": input_text}
            ) as response:
                if not response.ok:
                    body = await response.text()
                    raise RuntimeError(f"Embedding failed: {response.status} {body}")

                data = await response.json()
                vector = data.get("data", [{}])[0].get("embedding", [])
                if not vector or len(vector) < 10:
                    raise RuntimeError("Embedding response missing vector")
                return vector

    def _extract_document_data(self, doc: dict) -> dict:
        """Extract standardized fields from a search result document."""
        title = doc.get("document_title") or doc.get("title") or "Untitled"
        content = doc.get("content") or ""
        url = doc.get("source_url") or doc.get("url")

        return {
            "title": str(title).strip() or "Untitled",
            "content": str(content).strip(),
            "url": url or None,
        }

    def _doc_key(self, doc: dict) -> str:
        """Generate a unique key for deduplication."""
        title = (doc.get("title") or "").strip().lower()
        url = (doc.get("url") or "").strip().lower()
        content_sig = str(doc.get("content") or "")[:200]
        return f"{title}||{url}||{content_sig}"

    async def _do_lexical_search(self, query: str, top: int, req_id: str) -> list[dict]:
        """Perform lexical (keyword) search."""
        client = self._get_client()
        query_text = (query or "").strip() or "*"

        logger.info(f"[RAG:{req_id}] lexical query={query_text}")

        docs = []
        async with client:
            results = await client.search(
                search_text=query_text,
                top=top,
                query_type="simple"
            )
            async for result in results:
                extracted = self._extract_document_data(result)
                docs.append(extracted)
                if len(docs) >= top:
                    break

        return docs

    async def _do_faq_search(self, query: str, top: int, req_id: str) -> list[dict]:
        """Perform FAQ-targeted search."""
        client = self._get_client()
        q = (query or "").strip()
        faq_search_terms = f"FAQ OR frequently asked OR {q}"

        logger.info(f"[RAG:{req_id}] FAQ search query={faq_search_terms}")

        docs = []
        async with client:
            results = await client.search(
                search_text=faq_search_terms,
                top=top,
                query_type="simple",
                search_fields=["document_title", "content"]
            )
            async for result in results:
                extracted = self._extract_document_data(result)

                # Boost FAQ documents to the front
                title = (extracted.get("title") or "").lower()
                is_faq_doc = "faq" in title or "frequently" in title

                if is_faq_doc:
                    docs.insert(0, extracted)
                else:
                    docs.append(extracted)

                if len(docs) >= top:
                    break

        return docs

    async def _do_vector_search(self, query: str, top: int, req_id: str) -> list[dict]:
        """Perform vector (semantic) search."""
        client = self._get_client()
        q = (query or "").strip()
        if not q:
            return []

        vector = await self.embed_text(q)

        logger.info(f"[RAG:{req_id}] vector query={q}")
        logger.info(f"[RAG:{req_id}] vector field={self.vector_field}")

        docs = []
        async with client:
            from azure.search.documents.models import VectorizedQuery

            vector_query = VectorizedQuery(
                vector=vector,
                k_nearest_neighbors=max(top, 8),
                fields=self.vector_field
            )

            results = await client.search(
                search_text=None,
                vector_queries=[vector_query],
                top=top
            )
            async for result in results:
                extracted = self._extract_document_data(result)
                docs.append(extracted)
                if len(docs) >= top:
                    break

        return docs

    async def search_top_documents(
        self,
        query: str,
        top: int = 5,
        lang: str = "en",
        req_id: str = "noid"
    ) -> list[dict]:
        """
        Multi-pass retrieval strategy:
        1. FAQ priority search (if FAQ-related query)
        2. Vector search (best for multilingual)
        3. Lexical fallback
        """
        original_query = (query or "").strip()
        if not original_query:
            return []

        merged = []
        seen = set()

        def merge_in(docs: list[dict]):
            nonlocal merged
            for doc in docs or []:
                key = self._doc_key(doc)
                if key in seen:
                    continue
                seen.add(key)
                merged.append(doc)
                if len(merged) >= top:
                    break

        logger.info(f"[RAG:{req_id}] lang={lang} top={top}")
        logger.info(f"[RAG:{req_id}] query={original_query}")

        # Check if FAQ-related query
        is_faq_related = is_faq_query(original_query)
        logger.info(f"[RAG:{req_id}] is_faq_related={is_faq_related}")

        # 1) FAQ priority search
        if is_faq_related:
            try:
                faq_docs = await self._do_faq_search(original_query, max(top, 8), req_id)
                logger.info(f"[RAG:{req_id}] FAQ priority docs={len(faq_docs)}")
                merge_in(faq_docs)
            except Exception as e:
                logger.warning(f"[RAG:{req_id}] FAQ search failed: {e}")

        if len(merged) >= top:
            return merged[:top]

        # 2) Vector search (multilingual)
        if self._has_embedding_config():
            try:
                vector_docs = await self._do_vector_search(original_query, max(top, 8), req_id)
                logger.info(f"[RAG:{req_id}] vector docs={len(vector_docs)}")
                merge_in(vector_docs)
            except Exception as e:
                logger.warning(f"[RAG:{req_id}] vector search failed: {e}")
        else:
            logger.warning(f"[RAG:{req_id}] No embedding config -> vector search skipped")

        if len(merged) >= top:
            return merged[:top]

        # 3) Lexical fallback
        try:
            lexical_docs = await self._do_lexical_search(original_query, max(top, 8), req_id)
            logger.info(f"[RAG:{req_id}] lexical docs={len(lexical_docs)}")
            merge_in(lexical_docs)
        except Exception as e:
            logger.warning(f"[RAG:{req_id}] lexical search failed: {e}")

        return merged[:top]


# Module-level instance
_search_client: Optional[SearchClientWrapper] = None


def get_search_client() -> SearchClientWrapper:
    """Get the singleton search client instance."""
    global _search_client
    if _search_client is None:
        _search_client = SearchClientWrapper()
    return _search_client


async def search_top_documents(
    query: str,
    top: int = 5,
    lang: str = "en",
    req_id: str = "noid"
) -> list[dict]:
    """Convenience function to search documents."""
    client = get_search_client()
    return await client.search_top_documents(query, top, lang, req_id)
