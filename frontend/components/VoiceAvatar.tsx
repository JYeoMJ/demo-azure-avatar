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

function TranscriptPanel({
  transcripts,
  streamingTranscript,
}: {
  transcripts: TranscriptEntry[];
  streamingTranscript: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcripts, streamingTranscript]);

  if (transcripts.length === 0 && !streamingTranscript) {
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
      {/* Streaming transcript - shown while assistant is speaking */}
      {streamingTranscript && (
        <div className="flex justify-start">
          <div className="max-w-[80%] px-4 py-2.5 rounded-2xl bg-gray-100 text-gray-800 border-l-2 border-blue-400">
            <p className="text-sm leading-relaxed">{streamingTranscript}</p>
            <span className="inline-block w-1.5 h-4 bg-blue-400 animate-pulse ml-0.5 align-middle" />
          </div>
        </div>
      )}
    </div>
  );
}

export default function VoiceAvatar() {
  const {
    status,
    speakingState,
    transcripts,
    streamingTranscript,
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
              <p className="text-sm text-gray-500 text-center">
                Speak naturally - the avatar will respond automatically
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Conversation Panel */}
      <div className="w-full lg:w-[400px] bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col h-[600px]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 id="transcript-heading" className="text-lg font-semibold text-gray-900">
            Conversation
          </h2>
        </div>

        {/* Transcript */}
        <div
          className="flex-1 overflow-hidden"
          role="log"
          aria-labelledby="transcript-heading"
          aria-live="polite"
        >
          <TranscriptPanel transcripts={transcripts} streamingTranscript={streamingTranscript} />
        </div>
      </div>
    </div>
  );
}
