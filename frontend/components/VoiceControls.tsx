import React, { useState } from 'react';
import { ConnectionState } from '../types';

interface VoiceControlsProps {
  connectionState: ConnectionState;
  onConnect: () => void;
  onTalkStart: () => void;
  onTalkEnd: () => void;
}

const VoiceControls: React.FC<VoiceControlsProps> = ({
  connectionState,
  onConnect,
  onTalkStart,
  onTalkEnd
}) => {
  const [isPushing, setIsPushing] = useState(false);

  const handlePttDown = (e: React.PointerEvent | React.TouchEvent | React.MouseEvent) => {
    e.preventDefault(); // Prevent text selection or ghost clicks
    if (connectionState !== ConnectionState.CONNECTED) return;
    setIsPushing(true);
    onTalkStart();
  };

  const handlePttUp = (e: React.PointerEvent | React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    if (!isPushing) return;
    setIsPushing(false);
    onTalkEnd();
  };

  if (connectionState === ConnectionState.DISCONNECTED || connectionState === ConnectionState.ERROR) {
    return (
      <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 z-50 flex flex-col items-center gap-2 animate-fade-in-up">
        <button
          onClick={onConnect}
          className="flex items-center gap-2 px-8 py-4 bg-[#002A50] hover:bg-[#003366] text-white rounded-full font-bold shadow-2xl transition-all hover:scale-105 active:scale-95 ring-4 ring-white/50"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
          Start Live Voice
        </button>
        <span className="text-xs font-semibold text-slate-500 bg-white/80 px-2 py-1 rounded shadow-sm backdrop-blur-sm">
           Click to enable microphone
        </span>
      </div>
    );
  }

  if (connectionState === ConnectionState.CONNECTING) {
    return (
      <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 z-50">
        <div className="flex items-center gap-3 px-6 py-3 bg-white text-slate-600 rounded-full shadow-xl border border-slate-200">
           <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
           <span className="font-medium">Connecting...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 z-50 flex flex-col items-center gap-4">
       
       {/* Indicators */}
       <div className={`transition-all duration-300 transform ${isPushing ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}>
          <div className="bg-red-500 text-white px-4 py-1.5 rounded-full text-sm font-bold shadow-lg flex items-center gap-2">
             <span className="w-2 h-2 bg-white rounded-full animate-pulse"></span>
             LISTENING
          </div>
       </div>

       {/* PTT Button */}
       <div className="relative group">
          {/* Pulsing Rings */}
          <div className={`absolute inset-0 bg-[#F05A22] rounded-full opacity-0 transition-opacity duration-200 ${isPushing ? 'animate-ping opacity-40' : ''}`}></div>
          <div className={`absolute -inset-2 bg-[#F05A22] rounded-full opacity-0 transition-opacity duration-300 ${isPushing ? 'opacity-20' : ''}`}></div>

          <button
             onPointerDown={handlePttDown}
             onPointerUp={handlePttUp}
             onPointerLeave={handlePttUp}
             onTouchStart={handlePttDown}
             onTouchEnd={handlePttUp}
             onContextMenu={(e) => e.preventDefault()}
             className={`relative w-24 h-24 rounded-full flex items-center justify-center shadow-2xl border-4 transition-all duration-150 select-none ${
               isPushing
                 ? 'bg-[#F05A22] border-white scale-95'
                 : 'bg-white border-slate-100 hover:border-[#F05A22] scale-100 hover:scale-105'
             }`}
             style={{ touchAction: 'none' }} // Critical for preventing scroll on mobile while holding
          >
             <svg xmlns="http://www.w3.org/2000/svg" className={`h-10 w-10 transition-colors ${isPushing ? 'text-white' : 'text-[#002A50]'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
             </svg>
          </button>
       </div>

       <p className="text-sm font-medium text-slate-500 bg-white/90 px-3 py-1 rounded-full shadow-sm backdrop-blur-sm select-none">
          {isPushing ? 'Release to Send' : 'Hold Spacebar or Button to Speak'}
       </p>
    </div>
  );
};

export default VoiceControls;