"use client";

import React, { useEffect, useRef } from "react";
import { SessionStatus, SpeakingState } from "@/hooks/useVoiceAvatar";

interface AvatarPanelProps {
  status: SessionStatus;
  avatarStatus: "none" | "connecting" | "connected" | "failed";
  speakingState: SpeakingState;
  videoStream: MediaStream | null;
  audioStream: MediaStream | null;
  onConnect: () => void;
  onDisconnect: () => void;
}

function SpeakingIndicator({ state }: { state: SpeakingState }) {
  if (state === "idle") return null;

  return (
    <div
      className="absolute bottom-16 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/60 px-3 py-2 rounded-full backdrop-blur-sm"
      role="status"
      aria-live="polite"
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

export default function AvatarPanel({
  status,
  avatarStatus,
  speakingState,
  videoStream,
  audioStream,
  onConnect,
  onDisconnect,
}: AvatarPanelProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Attach video stream with cleanup
  useEffect(() => {
    const videoEl = videoRef.current;
    if (videoEl && videoStream) {
      videoEl.srcObject = videoStream;
    }
    // Cleanup on unmount or stream change to prevent memory leaks
    return () => {
      if (videoEl) {
        videoEl.srcObject = null;
      }
    };
  }, [videoStream]);

  // Attach audio stream with cleanup
  useEffect(() => {
    const audioEl = audioRef.current;
    if (audioEl && audioStream) {
      audioEl.srcObject = audioStream;
    }
    // Cleanup on unmount or stream change to prevent memory leaks
    return () => {
      if (audioEl) {
        audioEl.srcObject = null;
      }
    };
  }, [audioStream]);

  const isConnected = status === "connected";
  const isConnecting = status === "connecting";
  const hasError = status === "error" || status === "disconnected";

  // Status bar configuration
  const getStatusConfig = () => {
    if (isConnecting || avatarStatus === "connecting") {
      return {
        dotClass: "bg-yellow-500 animate-pulse",
        text: "Connecting...",
      };
    }
    if (isConnected && avatarStatus === "connected") {
      return {
        dotClass: "bg-green-500",
        text: "Avatar Connected",
      };
    }
    if (isConnected && avatarStatus === "failed") {
      return {
        dotClass: "bg-orange-500",
        text: "Voice-only mode",
      };
    }
    if (isConnected) {
      return {
        dotClass: "bg-green-500",
        text: "Connected",
      };
    }
    if (hasError) {
      return {
        dotClass: "bg-red-500",
        text: "Connection Error",
      };
    }
    return {
      dotClass: "bg-gray-400",
      text: "Ready to connect",
    };
  };

  const statusConfig = getStatusConfig();

  return (
    <div className="flex flex-col h-full items-center">
      {/* Title */}
      <h2 className="text-lg font-semibold text-[#1E3A5F] mb-4">
        Ask me anything about our DA SWAT team & projects
      </h2>

      {/* Video Container */}
      <div
        className="relative w-full max-w-md aspect-square bg-gradient-to-br from-[#B8CCE8] via-[#C8D8F0] to-[#D4E0F4] rounded-2xl overflow-hidden shadow-inner"
        role="region"
        aria-label="AI Avatar video display"
      >
        {videoStream ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            className="w-full h-full object-contain"
            style={{ backgroundColor: "#C8D8F0" }}
            aria-label="AI Avatar video stream"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {/* Show error overlay when not connected or error */}
            {(hasError || (!isConnected && !isConnecting)) && (
              <div className="text-center">
                {/* Error icon */}
                <div className="w-16 h-16 mx-auto mb-4 bg-red-100 rounded-full flex items-center justify-center">
                  <svg
                    className="w-8 h-8 text-red-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                </div>
                <p className="text-[#1E3A5F] font-medium mb-4">
                  {status === "error" ? "CONNECTION ERROR" : "Not Connected"}
                </p>
                <button
                  onClick={onConnect}
                  className="px-6 py-2.5 bg-[#00A3B4] hover:bg-[#008999] text-white font-medium rounded-full transition-colors"
                >
                  {status === "error" ? "Retry Connection" : "Start Conversation"}
                </button>
              </div>
            )}

            {/* Show connecting state */}
            {isConnecting && (
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-4 border-4 border-[#00A3B4] border-t-transparent rounded-full animate-spin" />
                <p className="text-[#1E3A5F] font-medium">Connecting...</p>
              </div>
            )}

            {/* Connected but no video (voice-only mode) */}
            {isConnected && !videoStream && (
              <div className="text-center">
                <div className="w-20 h-20 mx-auto mb-4 bg-white/50 rounded-full flex items-center justify-center">
                  <svg
                    className="w-10 h-10 text-[#00A3B4]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                    />
                  </svg>
                </div>
                <p className="text-[#1E3A5F] font-medium">
                  {avatarStatus === "failed" ? "Voice-only mode active" : "Speak to begin"}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Speaking indicator */}
        <SpeakingIndicator state={speakingState} />

        {/* Hidden audio element */}
        <audio ref={audioRef} autoPlay className="hidden" />
      </div>

      {/* Status Bar */}
      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${statusConfig.dotClass}`} />
          <span className="text-sm text-gray-600">{statusConfig.text}</span>
        </div>
        {isConnected && (
          <button
            onClick={onDisconnect}
            className="text-sm text-red-600 hover:text-red-700 font-medium"
          >
            Disconnect
          </button>
        )}
      </div>
    </div>
  );
}
