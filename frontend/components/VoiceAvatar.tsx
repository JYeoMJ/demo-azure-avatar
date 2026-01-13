"use client";

import { useEffect, useRef, useState } from "react";
import {
  useVoiceAvatar,
  SessionStatus,
  SpeakingState,
  TranscriptEntry,
} from "@/hooks/useVoiceAvatar";

function StatusBadge({ status }: { status: SessionStatus }) {
  const statusConfig: Record<
    SessionStatus,
    { dotColor: string; text: string; ariaLabel: string }
  > = {
    idle: { dotColor: "bg-gray-400", text: "IDLE", ariaLabel: "Ready to connect" },
    connecting: {
      dotColor: "bg-yellow-500 animate-pulse",
      text: "CONNECTING",
      ariaLabel: "Connecting to server",
    },
    connected: {
      dotColor: "bg-green-500",
      text: "CONNECTED",
      ariaLabel: "Connected and active",
    },
    error: {
      dotColor: "bg-red-500",
      text: "ERROR",
      ariaLabel: "Connection error occurred",
    },
    disconnected: {
      dotColor: "bg-gray-400",
      text: "DISCONNECTED",
      ariaLabel: "Disconnected from server",
    },
  };

  const config = statusConfig[status];

  return (
    <div
      className="flex items-center gap-2 bg-gray-100 px-3 py-1.5 rounded-full"
      role="status"
      aria-live="polite"
      aria-label={config.ariaLabel}
    >
      <span className={`w-2.5 h-2.5 rounded-full ${config.dotColor}`} aria-hidden="true" />
      <span className="text-xs font-medium text-gray-600">{config.text}</span>
    </div>
  );
}

function SpeakingIndicator({ state }: { state: SpeakingState }) {
  if (state === "idle") return null;

  const statusText = state === "user" ? "Listening to you" : "Assistant speaking";

  return (
    <div
      className="absolute bottom-4 left-4 flex items-center gap-2 bg-black/60 px-3 py-2 rounded-full backdrop-blur-sm"
      role="status"
      aria-live="polite"
      aria-label={statusText}
    >
      <div className="flex gap-1" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-1 h-4 bg-green-400 rounded-full animate-pulse"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
      <span className="text-sm text-white">
        {state === "user" ? "Listening..." : "Speaking..."}
      </span>
    </div>
  );
}

function TranscriptPanel({ transcripts }: { transcripts: TranscriptEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcripts]);

  if (transcripts.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-400 p-8">
        <svg
          className="w-12 h-12 mb-3 opacity-50"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
          />
        </svg>
        <p className="text-sm">Start a conversation with the assistant.</p>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto space-y-3 p-4">
      {transcripts.map((entry, index) => (
        <div
          key={index}
          className={`flex ${
            entry.role === "user" ? "justify-end" : "justify-start"
          }`}
        >
          <div
            className={`max-w-[80%] px-4 py-2.5 rounded-2xl ${
              entry.role === "user"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-800"
            }`}
          >
            <p className="text-sm leading-relaxed">{entry.text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function VoiceAvatar() {
  const {
    status,
    speakingState,
    transcripts,
    videoStream,
    audioStream,
    avatarStatus,
    turnBasedMode,
    connect,
    disconnect,
    sendTextMessage,
    triggerResponse,
    toggleMode,
  } = useVoiceAvatar({
    onError: (error) => console.error("Voice Avatar error:", error),
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [textInput, setTextInput] = useState("");

  const handleSendText = () => {
    if (textInput.trim() && status === "connected") {
      sendTextMessage(textInput);
      setTextInput("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendText();
    }
  };

  // Attach video stream
  useEffect(() => {
    if (videoRef.current && videoStream) {
      videoRef.current.srcObject = videoStream;
    }
  }, [videoStream]);

  // Attach audio stream
  useEffect(() => {
    if (audioRef.current && audioStream) {
      audioRef.current.srcObject = audioStream;
    }
  }, [audioStream]);

  const isConnected = status === "connected";
  const isConnecting = status === "connecting";

  return (
    <div className="flex flex-col lg:flex-row gap-6 w-full">
      {/* Avatar Panel */}
      <div className="flex-1 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-6 flex flex-col h-full">
          {/* Video Container */}
          <div
            className="relative flex-1 min-h-[400px] bg-gray-50 rounded-xl overflow-hidden"
            role="region"
            aria-label="AI Avatar video display"
          >
            {videoStream ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
                aria-label="AI Avatar video stream"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <div className="text-center text-gray-400">
                  <svg
                    className="w-20 h-20 mx-auto mb-4 opacity-40"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1}
                      d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                  {avatarStatus === "connecting" && (
                    <p className="text-yellow-600 font-medium">Connecting avatar...</p>
                  )}
                  {avatarStatus === "failed" && (
                    <p className="text-orange-600">Avatar unavailable - voice mode active</p>
                  )}
                  {avatarStatus === "none" && status === "connected" && (
                    <p className="text-blue-600">Voice-only mode</p>
                  )}
                  {avatarStatus === "none" && status !== "connected" && (
                    <p>Avatar will appear here</p>
                  )}
                </div>
              </div>
            )}

            <SpeakingIndicator state={speakingState} />

            {/* Status Badge */}
            <div className="absolute bottom-4 right-4">
              <StatusBadge status={status} />
            </div>

            {/* Hidden audio element for avatar voice */}
            <audio ref={audioRef} autoPlay className="hidden" />
          </div>

          {/* Controls */}
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex gap-3" role="group" aria-label="Conversation controls">
              {!isConnected ? (
                <button
                  onClick={connect}
                  disabled={isConnecting}
                  className="flex-1 py-3 px-6 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300
                             text-white font-medium rounded-xl transition-colors
                             focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                  aria-label={isConnecting ? "Connecting to voice avatar" : "Start voice conversation"}
                  aria-busy={isConnecting}
                >
                  {isConnecting ? "Connecting..." : "Start Conversation"}
                </button>
              ) : (
                <button
                  onClick={disconnect}
                  className="flex-1 py-3 px-6 bg-red-600 hover:bg-red-700
                             text-white font-medium rounded-xl transition-colors
                             focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                  aria-label="End voice conversation"
                >
                  End Conversation
                </button>
              )}
            </div>

            {isConnected && (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-gray-500 text-center">
                  {turnBasedMode
                    ? "Type a message or speak, then send to get a response"
                    : "Speak naturally - the avatar will respond automatically"}
                </p>
                {/* Send button for turn-based voice mode */}
                {turnBasedMode && speakingState === "idle" && (
                  <button
                    onClick={triggerResponse}
                    className="py-2 px-4 bg-green-600 hover:bg-green-700 text-white font-medium
                               rounded-xl transition-colors text-sm
                               focus:outline-none focus:ring-2 focus:ring-green-500"
                    aria-label="Send voice message and get response"
                  >
                    Send Voice Message
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Conversation Panel */}
      <div className="w-full lg:w-[400px] bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col h-[600px]">
        {/* Header with Mode Toggle */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 id="transcript-heading" className="text-lg font-semibold text-gray-900">
            Conversation
          </h2>
          {/* Mode Toggle */}
          {isConnected && (
            <div className="flex bg-gray-100 rounded-lg p-1" role="tablist" aria-label="Conversation mode">
              <button
                role="tab"
                aria-selected={turnBasedMode}
                onClick={() => toggleMode(true)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  turnBasedMode
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                Text Chat
              </button>
              <button
                role="tab"
                aria-selected={!turnBasedMode}
                onClick={() => toggleMode(false)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                  !turnBasedMode
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${!turnBasedMode ? "bg-green-400" : "bg-gray-400"}`} />
                Live Voice
              </button>
            </div>
          )}
        </div>

        {/* Transcript */}
        <div
          className="flex-1 overflow-hidden"
          role="log"
          aria-labelledby="transcript-heading"
          aria-live="polite"
        >
          <TranscriptPanel transcripts={transcripts} />
        </div>

        {/* Text Input */}
        {isConnected && (
          <div className="p-4 border-t border-gray-100">
            <div className="flex gap-2">
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask me about..."
                className="flex-1 px-4 py-2.5 bg-gray-50 text-gray-900 placeholder-gray-400
                           rounded-xl border border-gray-200 focus:border-blue-500
                           focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                aria-label="Type a message to send"
              />
              <button
                onClick={handleSendText}
                disabled={!textInput.trim()}
                className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200
                           disabled:cursor-not-allowed text-white rounded-xl transition-colors
                           focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-label="Send message"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 12h14M12 5l7 7-7 7"
                  />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
