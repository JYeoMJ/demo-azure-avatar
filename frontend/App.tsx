import React, { useState, useRef, useEffect, useCallback } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import AvatarView from './components/AvatarView';
import ChatInterface from './components/ChatInterface';
import VoiceControls from './components/VoiceControls';
import {
  ChatMessage,
  InteractionMode,
  AvatarConfig,
  ConnectionState,
  AvatarStatus,
  SpeakingState,
  VoiceLiveMessage,
  SessionReadyMessage,
  AvatarSdpMessage,
  TranscriptMessage,
  AudioDeltaMessage,
} from './types';
import { VoiceLiveService, createVoiceLiveService } from './services/voiceLiveService';
import { WebRTCService, createWebRTCService } from './services/webrtcService';
import {
  createPcmBase64,
  decodeAudio,
  decodeAudioData,
  calculateRmsLevel,
  VOICELIVE_SAMPLE_RATE,
} from './services/audioUtils';

// WebSocket URL - defaults to local backend
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000/ws/voice-avatar';

const App: React.FC = () => {
  // --- State ---
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [mode, setMode] = useState<InteractionMode>(InteractionMode.TEXT_CHAT);
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [isProcessing, setIsProcessing] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [speakingState, setSpeakingState] = useState<SpeakingState>('idle');
  const [avatarStatus, setAvatarStatus] = useState<AvatarStatus>('none');
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);

  // Refs
  const voiceLiveRef = useRef<VoiceLiveService | null>(null);
  const webrtcRef = useRef<WebRTCService | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isTalkingRef = useRef(false);

  // Audio Playback Queue (for voice-only mode fallback)
  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const [avatarConfig] = useState<AvatarConfig>({
    name: "Aria",
    role: "DTT Event Host",
    avatarUrl: "https://picsum.photos/600/600?grayscale",
    status: 'idle'
  });

  // --- Audio Context Management ---
  const getAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: VOICELIVE_SAMPLE_RATE
      });
    }
    return audioContextRef.current;
  };

  const getPlaybackContext = () => {
    if (!playbackContextRef.current) {
      playbackContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: VOICELIVE_SAMPLE_RATE
      });
    }
    return playbackContextRef.current;
  };

  const ensureAudioContextResumed = async () => {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    const playbackCtx = getPlaybackContext();
    if (playbackCtx.state === 'suspended') {
      await playbackCtx.resume();
    }
  };

  // --- Audio Playback Queue (for voice-only mode) ---
  const playNextInQueue = useCallback(() => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      return;
    }

    isPlayingRef.current = true;
    const buffer = audioQueueRef.current.shift()!;
    const ctx = getPlaybackContext();

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    currentSourceRef.current = source;
    source.onended = () => {
      currentSourceRef.current = null;
      playNextInQueue();
    };

    source.start();
  }, []);

  const queueAudioForPlayback = useCallback(async (base64Audio: string) => {
    try {
      const ctx = getPlaybackContext();
      const audioBytes = decodeAudio(base64Audio);
      const buffer = await decodeAudioData(audioBytes, ctx);

      audioQueueRef.current.push(buffer);

      if (!isPlayingRef.current) {
        playNextInQueue();
      }
    } catch (e) {
      console.error('[App] Error decoding audio:', e);
    }
  }, [playNextInQueue]);

  const stopAudioPlayback = useCallback(() => {
    audioQueueRef.current = [];
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop();
      } catch (e) {
        // Already stopped
      }
      currentSourceRef.current = null;
    }
    isPlayingRef.current = false;
  }, []);

  // --- VoiceLive Message Handler ---
  const handleVoiceLiveMessage = useCallback((msg: VoiceLiveMessage) => {
    switch (msg.type) {
      case 'session.ready': {
        const sessionMsg = msg as SessionReadyMessage;
        console.log('[App] Session ready, ICE servers:', sessionMsg.ice_servers?.length);
        setConnectionState(ConnectionState.CONNECTED);

        // Initialize WebRTC if we have ICE servers
        if (sessionMsg.ice_servers && sessionMsg.ice_servers.length > 0) {
          setAvatarStatus('connecting');
          const webrtc = webrtcRef.current;
          if (webrtc) {
            webrtc.init(sessionMsg.ice_servers);

            // Set up track handlers
            webrtc.onVideoTrack((stream) => {
              console.log('[App] Video track received');
              setVideoStream(stream);
            });

            webrtc.onAudioTrack((stream) => {
              console.log('[App] Audio track received');
              setAudioStream(stream);
            });

            // Handle WebRTC connection state changes
            webrtc.onConnectionStateChange((state) => {
              console.log('[App] WebRTC connection state changed:', state);
              if (state === 'connected') {
                setAvatarStatus('connected');
              } else if (state === 'failed' || state === 'disconnected') {
                setAvatarStatus('failed');
              }
            });

            // Create and send SDP offer
            webrtc.createOffer().then((sdp) => {
              voiceLiveRef.current?.sendAvatarSdp(sdp);
            }).catch((e) => {
              console.error('[App] Failed to create offer:', e);
              setAvatarStatus('failed');
            });
          }
        } else {
          // No ICE servers - voice-only mode
          setAvatarStatus('none');
        }
        break;
      }

      case 'avatar.sdp': {
        const sdpMsg = msg as AvatarSdpMessage;
        if (sdpMsg.server_sdp && webrtcRef.current) {
          webrtcRef.current.setRemoteAnswer(sdpMsg.server_sdp).catch((e) => {
            console.error('[App] Failed to set remote answer:', e);
            setAvatarStatus('failed');
          });
        }
        break;
      }

      case 'avatar.connected':
        console.log('[App] Avatar connected');
        setAvatarStatus('connected');
        break;

      case 'avatar.error':
        console.log('[App] Avatar error:', (msg as any).message);
        setAvatarStatus('failed');
        break;

      case 'user.speaking.started':
        setSpeakingState('user');
        stopAudioPlayback(); // Interrupt any playing audio
        break;

      case 'user.speaking.stopped':
        setSpeakingState('idle');
        break;

      case 'assistant.response.started':
        setIsProcessing(true);
        setSpeakingState('assistant');
        break;

      case 'assistant.speaking.done':
      case 'assistant.response.done':
      case 'assistant.response.cancelled':
        setIsProcessing(false);
        setSpeakingState('idle');
        break;

      case 'transcript': {
        const transcriptMsg = msg as TranscriptMessage;
        const newMessage: ChatMessage = {
          id: Date.now().toString(),
          role: transcriptMsg.role === 'user' ? 'user' : 'model',
          text: transcriptMsg.text,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, newMessage]);
        break;
      }

      case 'audio.delta': {
        // Voice-only mode fallback - play audio chunks
        const audioMsg = msg as AudioDeltaMessage;
        if (audioMsg.data && avatarStatus !== 'connected') {
          queueAudioForPlayback(audioMsg.data);
        }
        break;
      }

      case 'rag.started':
        setIsProcessing(true);
        break;

      case 'rag.sources':
        // Could display sources in UI if needed
        console.log('[App] RAG sources:', (msg as any).sources);
        break;

      case 'rag.error':
        console.error('[App] RAG error:', (msg as any).message);
        break;

      case 'error':
        console.error('[App] Error:', (msg as any).message);
        setConnectionState(ConnectionState.ERROR);
        break;

      case 'connection.closed':
        setConnectionState(ConnectionState.DISCONNECTED);
        break;
    }
  }, [avatarStatus, queueAudioForPlayback, stopAudioPlayback]);

  // --- Handlers ---
  const handleSendMessage = async () => {
    if (!inputValue.trim()) return;

    const text = inputValue.trim();
    setInputValue('');
    setIsProcessing(true);

    // If connected to VoiceLive, send via WebSocket
    if (voiceLiveRef.current?.isConnected) {
      voiceLiveRef.current.sendText(text);
    } else {
      // Fallback: show user message and error
      const userMessage: ChatMessage = {
        id: Date.now().toString(),
        role: 'user',
        text: text,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, userMessage]);
      setIsProcessing(false);

      // Show connection prompt
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: 'Please connect to the avatar service first by switching to Live Voice mode.',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    }
  };

  // PTT Handlers
  const handleTalkStart = useCallback(() => {
    if (connectionState === ConnectionState.CONNECTED) {
      isTalkingRef.current = true;
      voiceLiveRef.current?.sendAudioClear();
      startAudioCapture();
    }
  }, [connectionState]);

  const handleTalkEnd = useCallback(() => {
    isTalkingRef.current = false;
    stopAudioCapture();
    voiceLiveRef.current?.sendAudioCommit();
  }, []);

  // Keyboard PTT (Spacebar)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (mode === InteractionMode.REALTIME_VOICE && e.code === 'Space' && !e.repeat) {
        if (document.activeElement?.tagName !== 'TEXTAREA' && document.activeElement?.tagName !== 'INPUT') {
          e.preventDefault();
          handleTalkStart();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (mode === InteractionMode.REALTIME_VOICE && e.code === 'Space') {
        e.preventDefault();
        handleTalkEnd();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [mode, handleTalkStart, handleTalkEnd]);

  // --- Audio Capture ---
  const startAudioCapture = async () => {
    try {
      await ensureAudioContextResumed();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: VOICELIVE_SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        }
      });
      streamRef.current = stream;

      const ctx = getAudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (e) => {
        if (!isTalkingRef.current) {
          setAudioLevel(prev => Math.max(0, prev - 0.05));
          return;
        }

        const inputData = e.inputBuffer.getChannelData(0);
        const pcmBase64 = createPcmBase64(inputData);

        // Send to VoiceLive
        voiceLiveRef.current?.sendAudio(pcmBase64);

        // Update audio level for visualization
        const level = calculateRmsLevel(inputData);
        setAudioLevel(prev => (prev * 0.8) + (level * 0.2));
      };

      source.connect(processor);
      processor.connect(ctx.destination);

      inputSourceRef.current = source;
      processorRef.current = processor;
    } catch (e) {
      console.error('[App] Failed to start audio capture:', e);
    }
  };

  const stopAudioCapture = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (inputSourceRef.current) {
      inputSourceRef.current.disconnect();
      inputSourceRef.current = null;
    }
    setAudioLevel(0);
  };

  // --- Session Management ---
  const startLiveSession = async () => {
    try {
      setConnectionState(ConnectionState.CONNECTING);

      // Create services
      const voiceLive = createVoiceLiveService();
      const webrtc = createWebRTCService();

      voiceLiveRef.current = voiceLive;
      webrtcRef.current = webrtc;

      // Set up message handler
      voiceLive.onMessage(handleVoiceLiveMessage);

      // Connect to backend
      await voiceLive.connect(WS_URL);

      // Set mode based on current UI mode
      const backendMode = mode === InteractionMode.TEXT_CHAT ? 'text' : 'push-to-talk';
      voiceLive.setMode(backendMode);

    } catch (e) {
      console.error('[App] Failed to start session:', e);
      setConnectionState(ConnectionState.ERROR);
    }
  };

  const stopLiveSession = useCallback(() => {
    // Disconnect VoiceLive
    if (voiceLiveRef.current) {
      voiceLiveRef.current.disconnect();
      voiceLiveRef.current = null;
    }

    // Close WebRTC
    if (webrtcRef.current) {
      webrtcRef.current.close();
      webrtcRef.current = null;
    }

    // Stop audio capture
    stopAudioCapture();

    // Stop audio playback
    stopAudioPlayback();

    // Reset state
    setConnectionState(ConnectionState.DISCONNECTED);
    setAvatarStatus('none');
    setVideoStream(null);
    setAudioStream(null);
    setSpeakingState('idle');
    setAudioLevel(0);
    isTalkingRef.current = false;
  }, [stopAudioPlayback]);

  const handleConnectToggle = () => {
    if (connectionState === ConnectionState.CONNECTED) {
      stopLiveSession();
    } else {
      startLiveSession();
    }
  };

  const handleToggleMode = (newMode: InteractionMode) => {
    setMode(newMode);

    // Update backend mode if connected
    if (voiceLiveRef.current?.isConnected) {
      const backendMode = newMode === InteractionMode.TEXT_CHAT ? 'text' : 'push-to-talk';
      voiceLiveRef.current.setMode(backendMode);
    }
  };

  // Determine Avatar Status for UI
  const getAvatarUIStatus = (): AvatarConfig['status'] => {
    if (speakingState === 'assistant' || isProcessing) {
      return 'speaking';
    }
    if (speakingState === 'user' || audioLevel > 0.01) {
      return 'listening';
    }
    if (connectionState === ConnectionState.CONNECTED) {
      return 'active';
    }
    return 'idle';
  };

  return (
    <div className="flex flex-col h-screen bg-slate-50 text-slate-800 font-sans overflow-hidden">
      <Header />

      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar */}
        <div className="hidden lg:block h-full">
          <Sidebar />
        </div>

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col md:flex-row p-4 gap-4 overflow-hidden relative z-0">

          {/* Avatar Section */}
          <div className="flex-1 md:flex-[1.2] flex flex-col min-h-[300px]">
            <AvatarView
              config={{ ...avatarConfig, status: getAvatarUIStatus() }}
              audioLevel={audioLevel}
              videoStream={videoStream}
              audioStream={audioStream}
              avatarStatus={avatarStatus}
            />
          </div>

          {/* Conversation Section */}
          <div className="flex-1 flex flex-col h-full min-h-[400px]">
            <ChatInterface
              messages={messages}
              inputValue={inputValue}
              isProcessing={isProcessing}
              mode={mode}
              onInputChange={setInputValue}
              onSend={handleSendMessage}
              onToggleMode={handleToggleMode}
            />
          </div>
        </main>
      </div>

      {/* Floating PTT Controls (Voice Mode Only) */}
      {mode === InteractionMode.REALTIME_VOICE && (
        <VoiceControls
          connectionState={connectionState}
          onConnect={handleConnectToggle}
          onTalkStart={handleTalkStart}
          onTalkEnd={handleTalkEnd}
        />
      )}

      {/* Auto-connect for Text Chat mode */}
      {mode === InteractionMode.TEXT_CHAT && connectionState === ConnectionState.DISCONNECTED && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50">
          <button
            onClick={startLiveSession}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-full shadow-lg flex items-center space-x-2 transition-all"
          >
            <span>Connect to Avatar</span>
          </button>
        </div>
      )}

      {/* Connection Status Toast */}
      {connectionState === ConnectionState.CONNECTING && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-blue-100 border border-blue-400 text-blue-700 px-4 py-3 rounded relative z-50 flex items-center space-x-2">
          <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <span>Connecting to avatar service...</span>
        </div>
      )}

      {/* Error Toast */}
      {connectionState === ConnectionState.ERROR && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative z-50">
          <strong className="font-bold">Error:</strong>
          <span className="block sm:inline"> Connection failed. Check backend server.</span>
        </div>
      )}
    </div>
  );
};

export default App;
