import React, { useEffect, useState, useRef } from 'react';
import { AvatarConfig, AvatarStatus } from '../types';

interface AvatarViewProps {
  config: AvatarConfig;
  audioLevel: number; // 0 to 1 for visualizer
  videoStream?: MediaStream | null;  // WebRTC video stream
  audioStream?: MediaStream | null;  // WebRTC audio stream
  avatarStatus?: AvatarStatus;
}

const AvatarView: React.FC<AvatarViewProps> = ({
  config,
  audioLevel,
  videoStream,
  audioStream,
  avatarStatus = 'none'
}) => {
  const [glowSize, setGlowSize] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Animate glow based on audio level
  useEffect(() => {
    // Smooth dampening
    setGlowSize(prev => prev * 0.8 + (audioLevel * 50) * 0.2);
  }, [audioLevel]);

  // Attach video stream to video element
  useEffect(() => {
    if (videoRef.current && videoStream) {
      console.log('[AvatarView] Attaching video stream');
      videoRef.current.srcObject = videoStream;
    }
  }, [videoStream]);

  // Attach audio stream to audio element
  useEffect(() => {
    if (audioRef.current && audioStream) {
      console.log('[AvatarView] Attaching audio stream');
      audioRef.current.srcObject = audioStream;
    }
  }, [audioStream]);

  const hasVideoStream = videoStream && avatarStatus === 'connected';

  return (
    <div className="relative flex flex-col items-center justify-center w-full h-full bg-slate-100 rounded-xl overflow-hidden shadow-inner border border-slate-200">

      {/* Dynamic Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-slate-50 to-slate-200 opacity-50 z-0"></div>

      {/* Halo Effect for Speaking/Active State */}
      <div
        className="absolute rounded-full bg-blue-400/20 blur-xl z-0 transition-all duration-75"
        style={{
          width: `${300 + glowSize * 2}px`,
          height: `${300 + glowSize * 2}px`,
          opacity: config.status === 'speaking' ? 0.6 : 0.1
        }}
      />

      {/* Avatar Container */}
      <div className="relative z-10 w-64 h-64 md:w-80 md:h-80 rounded-full border-4 border-white shadow-lg overflow-hidden transition-transform duration-500 hover:scale-105">
        {/* Video Element (shown when WebRTC connected) */}
        {hasVideoStream ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={false}
            className="w-full h-full object-cover"
          />
        ) : (
          /* Static Image Fallback */
          <img
            src={config.avatarUrl}
            alt={config.name}
            className="w-full h-full object-cover"
          />
        )}

        {/* Avatar Status Overlay (connecting/failed) */}
        {avatarStatus === 'connecting' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <div className="text-white text-sm font-medium flex items-center space-x-2">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              <span>Connecting...</span>
            </div>
          </div>
        )}

        {avatarStatus === 'failed' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <div className="text-white text-xs font-medium text-center px-4">
              <p>Avatar unavailable</p>
              <p className="opacity-70">Using voice-only mode</p>
            </div>
          </div>
        )}

        {/* Status Indicator Overlay */}
        <div className="absolute bottom-4 right-10 flex items-center space-x-2 bg-white/90 backdrop-blur-sm px-3 py-1 rounded-full shadow-sm">
           <div className={`w-2.5 h-2.5 rounded-full ${
             config.status === 'speaking' ? 'bg-green-500 animate-pulse' :
             config.status === 'listening' ? 'bg-orange-500 animate-bounce' :
             config.status === 'idle' ? 'bg-slate-400' : 'bg-blue-500'
           }`}></div>
           <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
             {config.status}
           </span>
        </div>
      </div>

      {/* Hidden audio element for WebRTC audio */}
      <audio
        ref={audioRef}
        autoPlay
        playsInline
        style={{ display: 'none' }}
      />

      <div className="relative z-10 mt-8 text-center">
        <h2 className="text-2xl font-bold text-slate-800">{config.name}</h2>
        <p className="text-slate-500 text-sm font-medium mt-1">{config.role}</p>
      </div>

      {/* Visualizer Lines (Decorative) */}
      <div className="absolute bottom-0 w-full h-12 flex justify-center items-end space-x-1 pb-2 z-0 opacity-30">
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="w-2 bg-blue-900 rounded-t-sm transition-all duration-75 ease-in-out"
            style={{
              height: config.status === 'speaking' ? `${Math.max(10, Math.random() * 60)}%` : '10%'
            }}
          ></div>
        ))}
      </div>
    </div>
  );
};

export default AvatarView;
