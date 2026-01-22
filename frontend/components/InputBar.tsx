"use client";

import React, { useState } from "react";
import { SessionStatus, SpeakingState } from "@/hooks/useVoiceAvatar";

interface InputBarProps {
  status: SessionStatus;
  speakingState: SpeakingState;
  microphoneEnabled: boolean;
  textMode: boolean;
  onSendMessage: (text: string) => void;
  onToggleTextMode: (enabled: boolean) => void;
}

export default function InputBar({
  status,
  speakingState,
  microphoneEnabled,
  textMode,
  onSendMessage,
  onToggleTextMode,
}: InputBarProps) {
  const [textInput, setTextInput] = useState("");
  const isConnected = status === "connected";
  const isListening = speakingState === "user";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (textInput.trim() && isConnected) {
      onSendMessage(textInput);
      setTextInput("");
    }
  };

  const handleMicClick = () => {
    if (!isConnected) return;
    onToggleTextMode(!textMode);
  };

  return (
    <div className="bg-white/80 backdrop-blur-md border-t border-gray-200/50 px-4 py-3">
      <form onSubmit={handleSubmit} className="flex items-center gap-3">
        {/* Language badge (visual only) */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 rounded-full text-sm text-gray-600 shrink-0">
          <span className="text-xs">Detected:</span>
          <span className="font-medium">EN</span>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>

        {/* Text input */}
        <div className="flex-1 relative">
          <input
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder={
              !isConnected
                ? "Connect to start chatting..."
                : textMode
                  ? "Type your message..."
                  : "Type here or tap & hold the mic..."
            }
            disabled={!isConnected}
            className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-full
                     text-[#1E3A5F] placeholder-gray-400 text-sm
                     focus:outline-none focus:ring-2 focus:ring-[#00A3B4]/50 focus:border-[#00A3B4]
                     disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
            aria-label="Message input"
          />
        </div>

        {/* Mic button */}
        <button
          type="button"
          onClick={handleMicClick}
          disabled={!isConnected}
          className={`w-11 h-11 rounded-full flex items-center justify-center transition-all shrink-0
                     disabled:opacity-50 disabled:cursor-not-allowed
                     ${isListening || (isConnected && !textMode)
                       ? "bg-gradient-to-r from-[#00A3B4] to-[#1E3A5F] text-white shadow-lg"
                       : "bg-gray-200 text-gray-500 hover:bg-gray-300"
                     }
                     ${isListening ? "ring-4 ring-[#F58220]/50 animate-pulse" : ""}`}
          aria-label={textMode ? "Switch to voice mode" : "Switch to text mode"}
        >
          {textMode ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
              />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
              />
            </svg>
          )}
        </button>

        {/* Send button */}
        <button
          type="submit"
          disabled={!textInput.trim() || !isConnected}
          className={`px-5 py-2.5 rounded-full font-medium text-sm transition-all shrink-0
                     ${textInput.trim() && isConnected
                       ? "bg-[#00A3B4] hover:bg-[#008999] text-white shadow-md"
                       : "bg-gray-200 text-gray-400 cursor-not-allowed"
                     }`}
          aria-label="Send message"
        >
          Send
        </button>
      </form>
    </div>
  );
}
