"use client";

import React, { useEffect, useRef, memo } from "react";
import { TranscriptEntry } from "@/hooks/useVoiceAvatar";
import FaqSuggestions from "./FaqSuggestions";

interface ChatPanelProps {
  transcripts: TranscriptEntry[];
  streamingTranscript: string;
  onSendMessage: (text: string) => void;
}

const ChatPanel = memo(function ChatPanel({
  transcripts,
  streamingTranscript,
  onSendMessage,
}: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // Debounced auto-scroll
  useEffect(() => {
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    scrollTimeoutRef.current = setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }, 100);

    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [transcripts, streamingTranscript]);

  const showFaq = transcripts.length <= 3 && !streamingTranscript;
  const isEmpty = transcripts.length === 0 && !streamingTranscript;

  return (
    <div className="flex flex-col h-full bg-white/50 backdrop-blur-md rounded-2xl border border-white/60 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-200/50">
        <h2 className="text-lg font-semibold text-[#1E3A5F]">
          Digital Think Tank Booth
        </h2>
        <p className="text-xs text-gray-500 mt-0.5">
          This kiosk does not store any personal data
        </p>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto chat-scroll p-4 space-y-3"
        role="log"
        aria-live="polite"
      >
        {/* Empty state with welcome message */}
        {isEmpty && (
          <div className="flex justify-start mb-4">
            <div className="max-w-[85%] px-4 py-3 rounded-2xl rounded-bl-none bg-white/80 text-[#1E3A5F] border border-white/60 shadow-sm">
              <p className="text-sm leading-relaxed">
                Hello! I&apos;m your AI DTT assistant. Ask me anything about our Data Analytics SWAT team, current projects, or how to submit a project request.
              </p>
            </div>
          </div>
        )}

        {/* Transcript messages */}
        {transcripts.map((entry) => (
          <div
            key={entry.id}
            className={`flex ${entry.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] px-4 py-3 rounded-2xl shadow-sm ${
                entry.role === "user"
                  ? "bg-[#1E3A5F] text-white rounded-br-none"
                  : "bg-white/80 text-[#1E3A5F] rounded-bl-none border border-white/60"
              }`}
            >
              <p className="text-sm leading-relaxed">{entry.text}</p>
            </div>
          </div>
        ))}

        {/* Streaming transcript */}
        {streamingTranscript && (
          <div className="flex justify-start">
            <div className="max-w-[85%] px-4 py-3 rounded-2xl rounded-bl-none bg-white/80 text-[#1E3A5F] border border-white/60 shadow-sm">
              <p className="text-sm leading-relaxed">
                {streamingTranscript}
                <span className="inline-block w-0.5 h-4 bg-[#00A3B4] ml-0.5 align-middle typing-cursor" />
              </p>
            </div>
          </div>
        )}

        {/* FAQ suggestions */}
        {showFaq && (
          <FaqSuggestions onSelect={onSendMessage} />
        )}
      </div>
    </div>
  );
});

export default ChatPanel;
