"use client";

import { useEffect, useRef } from "react";
import {
  useVoiceAvatar,
  SessionStatus,
  SpeakingState,
  TranscriptEntry,
} from "@/hooks/useVoiceAvatar";

function StatusBadge({ status }: { status: SessionStatus }) {
  const statusConfig: Record<
    SessionStatus,
    { color: string; text: string; ariaLabel: string }
  > = {
    idle: { color: "bg-gray-500", text: "Ready", ariaLabel: "Ready to connect" },
    connecting: {
      color: "bg-yellow-500",
      text: "Connecting...",
      ariaLabel: "Connecting to server",
    },
    connected: {
      color: "bg-green-500",
      text: "Connected",
      ariaLabel: "Connected and active",
    },
    error: {
      color: "bg-red-500",
      text: "Error",
      ariaLabel: "Connection error occurred",
    },
    disconnected: {
      color: "bg-gray-500",
      text: "Disconnected",
      ariaLabel: "Disconnected from server",
    },
  };

  const config = statusConfig[status];

  return (
    <div
      className="flex items-center gap-2"
      role="status"
      aria-live="polite"
      aria-label={config.ariaLabel}
    >
      <div
        className={`w-3 h-3 rounded-full ${config.color}`}
        aria-hidden="true"
      />
      <span className="text-sm text-gray-300">{config.text}</span>
    </div>
  );
}

function SpeakingIndicator({ state }: { state: SpeakingState }) {
  if (state === "idle") return null;

  const statusText = state === "user" ? "Listening to you" : "Assistant speaking";

  return (
    <div
      className="absolute bottom-4 left-4 flex items-center gap-2 bg-black/50 px-3 py-2 rounded-full"
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
      <div className="h-full flex items-center justify-center text-gray-500">
        <p>Conversation will appear here...</p>
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
            className={`max-w-[80%] px-4 py-2 rounded-2xl ${
              entry.role === "user"
                ? "bg-blue-600 text-white"
                : "bg-gray-700 text-gray-100"
            }`}
          >
            <p className="text-sm">{entry.text}</p>
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
    connect,
    disconnect,
  } = useVoiceAvatar({
    onError: (error) => console.error("Voice Avatar error:", error),
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

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
    <div className="flex flex-col lg:flex-row gap-6 w-full max-w-6xl mx-auto p-6">
      {/* Avatar Video Section */}
      <div className="flex-1 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">AI Avatar</h2>
          <StatusBadge status={status} />
        </div>

        {/* Video Container */}
        <div
          className="relative aspect-[9/16] max-h-[600px] bg-gray-900 rounded-2xl overflow-hidden"
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
              <div className="text-center text-gray-500">
                <svg
                  className="w-16 h-16 mx-auto mb-4 opacity-50"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  role="img"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
                {avatarStatus === "connecting" && (
                  <p className="text-yellow-400">Connecting avatar...</p>
                )}
                {avatarStatus === "failed" && (
                  <p className="text-orange-400">Avatar unavailable - voice mode active</p>
                )}
                {avatarStatus === "none" && status === "connected" && (
                  <p className="text-blue-400">Voice-only mode</p>
                )}
                {(avatarStatus === "none" && status !== "connected") && (
                  <p>Avatar will appear here</p>
                )}
              </div>
            </div>
          )}

          <SpeakingIndicator state={speakingState} />

          {/* Hidden audio element for avatar voice */}
          <audio ref={audioRef} autoPlay className="hidden" />
        </div>

        {/* Controls */}
        <div className="flex gap-4" role="group" aria-label="Conversation controls">
          {!isConnected ? (
            <button
              onClick={connect}
              disabled={isConnecting}
              className="flex-1 py-3 px-6 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600
                         text-white font-medium rounded-xl transition-colors
                         focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900"
              aria-label={isConnecting ? "Connecting to voice avatar" : "Start voice conversation with AI avatar"}
              aria-busy={isConnecting}
            >
              {isConnecting ? "Connecting..." : "Start Conversation"}
            </button>
          ) : (
            <button
              onClick={disconnect}
              className="flex-1 py-3 px-6 bg-red-600 hover:bg-red-700
                         text-white font-medium rounded-xl transition-colors
                         focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-gray-900"
              aria-label="End voice conversation"
            >
              End Conversation
            </button>
          )}
        </div>

        {isConnected && (
          <p className="text-sm text-gray-400 text-center">
            Speak naturally - the avatar will respond to you
          </p>
        )}
      </div>

      {/* Transcript Section */}
      <div className="w-full lg:w-96 flex flex-col gap-4">
        <h2 id="transcript-heading" className="text-xl font-semibold text-white">
          Conversation
        </h2>
        <div
          className="flex-1 bg-gray-800/50 rounded-2xl min-h-[400px] max-h-[600px]"
          role="log"
          aria-labelledby="transcript-heading"
          aria-live="polite"
        >
          <TranscriptPanel transcripts={transcripts} />
        </div>
      </div>
    </div>
  );
}
