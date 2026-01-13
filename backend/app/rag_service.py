"""RAG service for retrieval-augmented generation."""

import os
import re
import logging
from typing import Optional

from .search_client import search_top_documents
from .openai_client import get_chat_completion

logger = logging.getLogger(__name__)

# Default RAG system prompt - can be overridden via environment variable
DEFAULT_RAG_SYSTEM_PROMPT = """
You are an AI assistant for the Digital Think Tank team at an internal company event. You're friendly, approachable, and knowledgeable—like a helpful colleague who knows the team well.

Your role is to answer questions about the team, projects, and initiatives using information from the knowledge base. Keep responses conversational and clear, as if chatting naturally with a coworker.

CRITICAL GROUNDING RULES - NEVER VIOLATE:
You MUST ONLY use information that appears in the retrieved documents below.
NEVER create, invent, or assume any of the following:
- Team member names, roles, or responsibilities
- Project names, timelines, or outcomes
- Technical details, metrics, or statistics

If you cannot find specific information in the retrieved documents, you MUST say: "I don't have that specific information in our current documents" and then offer related information you DO have, or ask a clarifying question.

RESPONSE LENGTH - STRICTLY ENFORCED:
YOUR RESPONSE MUST BE 3-4 SENTENCES MAX. This is non-negotiable.
- Prioritize the most important information only
- It's better to be brief than complete
- Responses are spoken aloud, so keep them conversational

RESPONSE STYLE:
- Use simple, natural phrasing as if speaking aloud
- Start with a direct answer
- No markdown symbols (no **, *, _, #)
- No bullet points or numbered lists

VERIFICATION CHECK - Before each response, ask yourself:
"Did I see this exact name/detail/fact in the retrieved documents?"
If NO → Do not include it in your response
If UNSURE → Do not include it in your response
If YES → Include it with confidence

---

RETRIEVED DOCUMENTS:

{context}
""".strip()


def clean_retrieved_text(text: str = "") -> str:
    """Clean retrieved document text of HTML/markdown."""
    text = str(text)
    text = re.sub(r"<[^>]+>", "", text)  # Remove HTML tags
    text = re.sub(r"\*\*", "", text)  # Remove bold markdown
    text = re.sub(r"[*_#]", "", text)  # Remove other markdown
    text = re.sub(r"\r", "", text)  # Remove carriage returns
    text = re.sub(r"[ \t]{2,}", " ", text)  # Collapse multiple spaces
    text = re.sub(r"\n{3,}", "\n\n", text)  # Collapse multiple newlines
    return text.strip()


def clean_model_output(text: str = "") -> str:
    """Clean model output for spoken delivery."""
    text = str(text)
    text = re.sub(r"<[^>]+>", "", text)  # Remove HTML tags
    text = re.sub(r"\*\*", "", text)  # Remove bold markdown
    text = re.sub(r"[*_#]", "", text)  # Remove other markdown
    text = re.sub(r"\r", "", text)  # Remove carriage returns
    text = re.sub(r"[ \t]{2,}", " ", text)  # Collapse multiple spaces
    return text.strip()


def format_context(docs: list[dict]) -> str:
    """Format retrieved documents into context string."""
    if not docs:
        return "No relevant sources were retrieved from search."

    formatted = []
    for i, doc in enumerate(docs, 1):
        title = clean_retrieved_text(doc.get("title", ""))
        url = doc.get("url") or "N/A"
        content = clean_retrieved_text(doc.get("content", ""))
        formatted.append(f"Source [{i}]: {title}\nURL: {url}\nContent:\n{content}")

    return "\n\n".join(formatted)


def get_language_instruction(lang: str) -> str:
    """Get language-specific instruction."""
    lang_map = {
        "en": "Respond in English.",
        "zh": "Respond in Simplified Chinese (中文).",
        "ms": "Respond in Malay (Bahasa Melayu).",
        "ta": "Respond in Tamil (தமிழ்).",
    }
    # Extract base language code
    base_lang = lang.split("-")[0].lower() if lang else "en"
    return lang_map.get(base_lang, "Respond in English.")


class SessionMemory:
    """Simple in-memory session storage for conversation history."""

    def __init__(self, max_messages: int = 10):
        self._sessions: dict[str, list[dict]] = {}
        self._max_messages = max_messages

    def get_messages(self, session_id: str) -> list[dict]:
        """Get conversation history for a session."""
        return self._sessions.get(session_id, [])

    def add_message(self, session_id: str, role: str, content: str):
        """Add a message to session history."""
        if session_id not in self._sessions:
            self._sessions[session_id] = []

        self._sessions[session_id].append({
            "role": role,
            "content": content
        })

        # Trim to max messages (keep system message space)
        if len(self._sessions[session_id]) > self._max_messages:
            self._sessions[session_id] = self._sessions[session_id][-self._max_messages:]

    def clear_session(self, session_id: str):
        """Clear a session's history."""
        if session_id in self._sessions:
            del self._sessions[session_id]


# Module-level session memory
_session_memory = SessionMemory()


async def generate_rag_response(
    query: str,
    session_id: str = "default",
    lang: str = "en",
    req_id: str = "noid"
) -> dict:
    """
    Generate a RAG-grounded response.

    Args:
        query: User's question/message
        session_id: Session ID for conversation history
        lang: Language code for response
        req_id: Request ID for logging

    Returns:
        Dict with 'response', 'sources', and metadata
    """
    logger.info(f"[RAG:{req_id}] query={query}")
    logger.info(f"[RAG:{req_id}] session_id={session_id}, lang={lang}")

    # 1. Retrieve relevant documents
    try:
        docs = await search_top_documents(query, top=5, lang=lang, req_id=req_id)
    except Exception as e:
        logger.error(f"[RAG:{req_id}] Search failed: {e}")
        docs = []

    logger.info(f"[RAG:{req_id}] Retrieved {len(docs)} documents")

    # Log document titles
    for i, doc in enumerate(docs):
        logger.info(f"[RAG:{req_id}] Doc [{i+1}]: {doc.get('title', 'Untitled')}")

    # 2. Format context
    context = format_context(docs)

    # 3. Build system prompt with context
    system_prompt_template = os.getenv("RAG_SYSTEM_PROMPT", DEFAULT_RAG_SYSTEM_PROMPT)
    language_instruction = get_language_instruction(lang)

    system_prompt = system_prompt_template.format(context=context)
    system_prompt += f"\n\nLANGUAGE: {language_instruction}"

    # 4. Get conversation history
    history = _session_memory.get_messages(session_id)

    # 5. Build messages for model
    messages = [
        {"role": "system", "content": system_prompt},
        *history,
        {"role": "user", "content": query}
    ]

    # 6. Get completion
    try:
        raw_response = await get_chat_completion(
            messages,
            temperature=0.2,
            max_tokens=300,
            req_id=req_id
        )
        response = clean_model_output(raw_response)
    except Exception as e:
        logger.error(f"[RAG:{req_id}] Chat completion failed: {e}")
        response = "I'm sorry, I encountered an error processing your request. Please try again."

    # 7. Update session memory
    _session_memory.add_message(session_id, "user", query)
    _session_memory.add_message(session_id, "assistant", response)

    # 8. Format sources metadata
    sources = [
        {
            "title": clean_retrieved_text(doc.get("title", "")),
            "url": doc.get("url")
        }
        for doc in docs
    ]

    return {
        "response": response,
        "sources": sources,
        "query": query,
        "lang": lang,
        "req_id": req_id
    }


def clear_session(session_id: str):
    """Clear conversation history for a session."""
    _session_memory.clear_session(session_id)
