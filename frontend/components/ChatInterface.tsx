import React, { useRef, useEffect } from 'react';
import { ChatMessage, InteractionMode } from '../types';

interface ChatInterfaceProps {
  messages: ChatMessage[];
  inputValue: string;
  isProcessing: boolean;
  mode: InteractionMode;
  onInputChange: (val: string) => void;
  onSend: () => void;
  onToggleMode: (mode: InteractionMode) => void;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({
  messages,
  inputValue,
  isProcessing,
  mode,
  onInputChange,
  onSend,
  onToggleMode,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden relative">
      {/* Header / Mode Switcher */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
        <h3 className="font-semibold text-slate-700">Conversation</h3>
        <div className="flex bg-slate-200 rounded-lg p-1">
          <button
            onClick={() => onToggleMode(InteractionMode.TEXT_CHAT)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              mode === InteractionMode.TEXT_CHAT
                ? 'bg-white text-blue-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Text Chat
          </button>
          <button
            onClick={() => onToggleMode(InteractionMode.REALTIME_VOICE)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-1 ${
              mode === InteractionMode.REALTIME_VOICE
                ? 'bg-white text-[#F05A22] shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <span className="relative flex h-2 w-2">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75 ${mode === InteractionMode.REALTIME_VOICE ? '' : 'hidden'}`}></span>
              <span className={`relative inline-flex rounded-full h-2 w-2 ${mode === InteractionMode.REALTIME_VOICE ? 'bg-orange-500' : 'bg-slate-400'}`}></span>
            </span>
            Live Voice
          </button>
        </div>
      </div>

      {/* Messages Area */}
      <div 
        ref={scrollRef} 
        className={`flex-1 overflow-y-auto p-6 space-y-6 ${mode === InteractionMode.REALTIME_VOICE ? 'pb-32' : ''}`}
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 text-sm">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-2 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <p>Start a conversation with Aria.</p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-5 py-3 text-sm leading-relaxed shadow-sm ${
                  msg.role === 'user'
                    ? 'bg-[#002A50] text-white rounded-br-none'
                    : 'bg-slate-100 text-slate-800 rounded-bl-none border border-slate-200'
                }`}
              >
                {msg.text}
              </div>
            </div>
          ))
        )}
        {isProcessing && mode === InteractionMode.TEXT_CHAT && (
          <div className="flex justify-start">
            <div className="bg-slate-100 rounded-2xl rounded-bl-none px-5 py-4 flex space-x-1 items-center">
              <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></div>
              <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce delay-100"></div>
              <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce delay-200"></div>
            </div>
          </div>
        )}
      </div>

      {/* Input Area (Text Mode Only) */}
      {mode === InteractionMode.TEXT_CHAT && (
        <div className="bg-white border-t border-slate-100 p-4">
          <div className="relative flex items-center gap-2">
            <textarea
              value={inputValue}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask me about the SWAT Team..."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900/10 focus:border-[#002A50] resize-none h-[52px]"
            />
            <button
              onClick={onSend}
              disabled={!inputValue.trim() || isProcessing}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-[#002A50] hover:text-[#F05A22] disabled:opacity-30 disabled:hover:text-[#002A50] transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
              </svg>
            </button>
          </div>
        </div>
      )}
      
      {/* Visual spacer for Voice Mode to ensure text isn't hidden behind the floating button */}
      {mode === InteractionMode.REALTIME_VOICE && (
         <div className="h-8 w-full bg-slate-50/50"></div>
      )}
    </div>
  );
};

export default ChatInterface;