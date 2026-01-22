"use client";

import React, { useState } from "react";
import { useVoiceAvatar } from "@/hooks/useVoiceAvatar";
import AvatarPanel from "./AvatarPanel";
import ChatPanel from "./ChatPanel";
import InputBar from "./InputBar";

export default function VoiceAvatar() {
  const {
    status,
    speakingState,
    transcripts,
    streamingTranscript,
    videoStream,
    audioStream,
    avatarStatus,
    microphoneEnabled,
    connect,
    disconnect,
    sendTextMessage,
    setMicrophoneEnabled,
  } = useVoiceAvatar({
    onError: (error) => console.error("Voice Avatar error:", error),
  });

  const [textMode, setTextMode] = useState(false);

  // Handle text mode toggle
  const handleTextModeToggle = (enabled: boolean) => {
    setTextMode(enabled);
    setMicrophoneEnabled(!enabled);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-88px)]">
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col lg:flex-row gap-6 p-6 overflow-hidden">
        {/* Avatar Panel - 60% width on large screens */}
        <div className="w-full lg:w-[60%] bg-white/50 backdrop-blur-md rounded-2xl border border-white/60 p-5 shadow-lg">
          <AvatarPanel
            status={status}
            avatarStatus={avatarStatus}
            speakingState={speakingState}
            videoStream={videoStream}
            audioStream={audioStream}
            onConnect={connect}
            onDisconnect={disconnect}
          />
        </div>

        {/* Chat Panel - 40% width on large screens */}
        <div className="w-full lg:w-[40%] flex-1 lg:flex-none shadow-lg">
          <ChatPanel
            transcripts={transcripts}
            streamingTranscript={streamingTranscript}
            onSendMessage={sendTextMessage}
          />
        </div>
      </div>

      {/* Color Bar */}
      <div className="color-bar h-1.5" />

      {/* Input Bar */}
      <InputBar
        status={status}
        speakingState={speakingState}
        microphoneEnabled={microphoneEnabled}
        textMode={textMode}
        onSendMessage={sendTextMessage}
        onToggleTextMode={handleTextModeToggle}
      />
    </div>
  );
}
