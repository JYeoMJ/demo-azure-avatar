"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  SAMPLE_RATE,
  CHANNELS,
  decodeBase64ToPCM16,
  encodePCM16ToBase64,
  createAudioBuffer,
} from "@/lib/audio-utils";

export type SessionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "error"
  | "disconnected";

export type SpeakingState = "idle" | "user" | "assistant";

export interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
  timestamp: Date;
}

interface UseVoiceAvatarOptions {
  wsUrl?: string;
  onError?: (error: string) => void;
  maxReconnectAttempts?: number;
}

interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

// WebSocket message type definitions for type safety
interface SessionReadyMessage {
  type: "session.ready";
  ice_servers?: IceServer[];
}

interface AvatarSdpMessage {
  type: "avatar.sdp";
  server_sdp?: string;
}

interface TranscriptMessage {
  type: "transcript";
  role: "user" | "assistant";
  text: string;
}

interface TranscriptDeltaMessage {
  type: "transcript.delta";
  role: "assistant";
  delta: string;
}

interface AudioDeltaMessage {
  type: "audio.delta";
  data?: string;
}

interface ErrorMessage {
  type: "error";
  message: string;
  code?: string;
}

type ServerMessage =
  | SessionReadyMessage
  | AvatarSdpMessage
  | TranscriptMessage
  | TranscriptDeltaMessage
  | AudioDeltaMessage
  | ErrorMessage
  | { type: string; [key: string]: unknown };

// Type guards for WebSocket messages
function isSessionReadyMessage(data: unknown): data is SessionReadyMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as Record<string, unknown>).type === "session.ready"
  );
}

function isTranscriptMessage(data: unknown): data is TranscriptMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as Record<string, unknown>).type === "transcript" &&
    ["user", "assistant"].includes(
      (data as Record<string, unknown>).role as string
    ) &&
    typeof (data as Record<string, unknown>).text === "string"
  );
}

function isTranscriptDeltaMessage(data: unknown): data is TranscriptDeltaMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as Record<string, unknown>).type === "transcript.delta" &&
    typeof (data as Record<string, unknown>).delta === "string"
  );
}

function isAudioDeltaMessage(data: unknown): data is AudioDeltaMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as Record<string, unknown>).type === "audio.delta"
  );
}

function isErrorMessage(data: unknown): data is ErrorMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as Record<string, unknown>).type === "error" &&
    typeof (data as Record<string, unknown>).message === "string"
  );
}

const DEFAULT_WS_URL =
  process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000/ws/voice-avatar";

export function useVoiceAvatar(options: UseVoiceAvatarOptions = {}) {
  const { wsUrl = DEFAULT_WS_URL, onError, maxReconnectAttempts = 5 } = options;

  // State
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [speakingState, setSpeakingState] = useState<SpeakingState>("idle");
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [streamingTranscript, setStreamingTranscript] = useState<string>("");
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [avatarStatus, setAvatarStatus] = useState<
    "none" | "connecting" | "connected" | "failed"
  >("none");
  const [turnBasedMode, setTurnBasedMode] = useState(false);

  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | AudioWorkletNode | null>(
    null
  );
  // Audio playback refs (for voice-only mode)
  const playbackContextRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef = useRef<boolean>(false);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  // Reconnection refs
  const reconnectAttemptsRef = useRef<number>(0);
  const shouldReconnectRef = useRef<boolean>(false);
  // Track avatar SDP negotiation to prevent duplicates
  const avatarSdpSentRef = useRef<boolean>(false);

  // Cleanup function
  const cleanup = useCallback(() => {
    // Stop audio processing
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // Stop audio playback
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop();
      } catch (e) {
        // Ignore
      }
      currentSourceRef.current = null;
    }
    if (playbackContextRef.current) {
      playbackContextRef.current.close();
      playbackContextRef.current = null;
    }
    audioQueueRef.current = [];
    isPlayingRef.current = false;

    // Stop media stream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    // Close peer connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setVideoStream(null);
    setAudioStream(null);
    // Reset avatar SDP tracking
    avatarSdpSentRef.current = false;
  }, []);

  // Play audio from base64 PCM16 data (voice-only mode)
  const playAudioChunk = useCallback(async (base64Data: string) => {
    try {
      // Create playback context if needed
      if (!playbackContextRef.current) {
        playbackContextRef.current = new AudioContext({
          sampleRate: SAMPLE_RATE,
        });
      }
      const ctx = playbackContextRef.current;

      // Use utility functions for conversion
      const float32 = decodeBase64ToPCM16(base64Data);
      const audioBuffer = createAudioBuffer(ctx, float32);

      // Queue and play
      audioQueueRef.current.push(audioBuffer);

      // Start playback if not already playing
      if (!isPlayingRef.current) {
        playNextInQueue();
      }
    } catch (error) {
      console.error("Error playing audio chunk:", error);
    }
  }, []);

  // Stop audio playback immediately (for interruption)
  const stopAudioPlayback = useCallback(() => {
    // Stop current playing source
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.onended = null; // Prevent callback
        currentSourceRef.current.stop();
      } catch (e) {
        // Ignore errors if already stopped
      }
      currentSourceRef.current = null;
    }
    // Clear the queue
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    console.log("Audio playback interrupted");
  }, []);

  // Play next audio buffer in queue
  const playNextInQueue = useCallback(() => {
    if (audioQueueRef.current.length === 0 || !playbackContextRef.current) {
      isPlayingRef.current = false;
      currentSourceRef.current = null;
      return;
    }

    isPlayingRef.current = true;
    const buffer = audioQueueRef.current.shift()!;
    const source = playbackContextRef.current.createBufferSource();
    source.buffer = buffer;
    source.connect(playbackContextRef.current.destination);
    source.onended = () => {
      currentSourceRef.current = null;
      playNextInQueue();
    };
    currentSourceRef.current = source;
    source.start();
  }, []);

  // Initialize WebRTC peer connection
  const initPeerConnection = useCallback((iceServers: IceServer[]) => {
    console.log("=== WebRTC Init ===");
    console.log("ICE servers received:", JSON.stringify(iceServers, null, 2));

    const config: RTCConfiguration = {
      iceServers:
        iceServers.length > 0
          ? iceServers
          : [{ urls: "stun:stun.l.google.com:19302" }],
    };

    console.log("RTCPeerConnection config:", JSON.stringify(config, null, 2));
    const pc = new RTCPeerConnection(config);

    // Add transceivers for receiving video and audio
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });
    console.log("Transceivers added (video + audio recvonly)");

    // Handle incoming tracks (avatar video/audio)
    pc.ontrack = (event) => {
      console.log(`Track received: ${event.track.kind}, id: ${event.track.id}, state: ${event.track.readyState}`);
      if (event.track.kind === "video") {
        console.log("Setting video stream");
        setVideoStream(event.streams[0]);
      } else if (event.track.kind === "audio") {
        console.log("Setting audio stream");
        setAudioStream(event.streams[0]);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log("ICE connection state:", pc.iceConnectionState);
    };

    pc.onconnectionstatechange = () => {
      console.log("Connection state:", pc.connectionState);
    };

    pc.onicegatheringstatechange = () => {
      console.log("ICE gathering state:", pc.iceGatheringState);
    };

    pc.onsignalingstatechange = () => {
      console.log("Signaling state:", pc.signalingState);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log("ICE candidate:", event.candidate.candidate.substring(0, 50) + "...");
      } else {
        console.log("ICE gathering complete");
      }
    };

    peerConnectionRef.current = pc;
    console.log("===================");
    return pc;
  }, []);

  // Create and send SDP offer
  const createAndSendOffer = useCallback(async (pc: RTCPeerConnection) => {
    try {
      console.log("=== Creating SDP Offer ===");
      const offer = await pc.createOffer();
      console.log("SDP offer created, type:", offer.type);
      await pc.setLocalDescription(offer);
      console.log("Local description set");

      // Wait for ICE gathering to complete
      console.log("Waiting for ICE gathering...");
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === "complete") {
          resolve();
        } else {
          const checkState = () => {
            if (pc.iceGatheringState === "complete") {
              // Clean up listener to prevent memory leak
              pc.removeEventListener("icegatheringstatechange", checkState);
              resolve();
            }
          };
          // Use addEventListener instead of direct assignment to prevent overwriting
          pc.addEventListener("icegatheringstatechange", checkState);
        }
      });

      console.log("ICE gathering complete, sending SDP to backend");
      console.log("SDP length:", pc.localDescription?.sdp?.length, "chars");

      // Send SDP to backend
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "avatar.sdp",
            sdp: pc.localDescription?.sdp,
          })
        );
        console.log("SDP offer sent to backend");
      } else {
        console.error("WebSocket not open, cannot send SDP");
      }
      console.log("==========================");
    } catch (error) {
      console.error("Error creating SDP offer:", error);
    }
  }, []);

  // Start microphone capture and audio streaming
  const startAudioCapture = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: SAMPLE_RATE,
          channelCount: CHANNELS,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      mediaStreamRef.current = stream;

      // Create audio context for processing
      const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);

      // Try to use AudioWorklet (modern API) with fallback to ScriptProcessor
      let useWorklet = false;
      if (audioContext.audioWorklet) {
        try {
          await audioContext.audioWorklet.addModule("/audio-processor.js");
          useWorklet = true;
          console.log("Using AudioWorklet for audio processing");
        } catch (workletError) {
          console.warn(
            "AudioWorklet not available, falling back to ScriptProcessor:",
            workletError
          );
        }
      }

      if (useWorklet) {
        // Modern AudioWorklet approach (better performance)
        const workletNode = new AudioWorkletNode(audioContext, "pcm-processor");

        workletNode.port.onmessage = (event: MessageEvent) => {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            // Data comes as ArrayBuffer of Int16 values
            const int16Buffer = new Int16Array(event.data);
            // Convert Int16 to Float32 for encoding utility
            const float32 = new Float32Array(int16Buffer.length);
            for (let i = 0; i < int16Buffer.length; i++) {
              float32[i] = int16Buffer[i] / 32768;
            }
            const base64 = encodePCM16ToBase64(float32);
            wsRef.current.send(
              JSON.stringify({
                type: "audio",
                data: base64,
              })
            );
          }
        };

        source.connect(workletNode);
        // AudioWorklet doesn't need to connect to destination
        processorRef.current = workletNode;
      } else {
        // Fallback to deprecated ScriptProcessor for older browsers
        console.warn(
          "Using deprecated ScriptProcessor - consider updating browser"
        );
        const processor = audioContext.createScriptProcessor(
          4096,
          CHANNELS,
          CHANNELS
        );

        processor.onaudioprocess = (e) => {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            const inputData = e.inputBuffer.getChannelData(0);
            const base64 = encodePCM16ToBase64(inputData);
            wsRef.current.send(
              JSON.stringify({
                type: "audio",
                data: base64,
              })
            );
          }
        };

        source.connect(processor);
        processor.connect(audioContext.destination);
        processorRef.current = processor;
      }

      console.log("Audio capture started");
    } catch (error) {
      console.error("Error starting audio capture:", error);
      onError?.("Failed to access microphone");
    }
  }, [onError]);

  // Handle WebSocket messages
  const handleMessage = useCallback(
    async (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        console.log("Received:", data.type);

        switch (data.type) {
          case "session.ready":
            console.log("=== Session Ready ===");
            setStatus("connected");
            // Start capturing audio immediately (voice-only mode)
            // Only start if not already capturing
            if (!audioContextRef.current) {
              await startAudioCapture();
            } else {
              console.log("Audio capture already active, skipping");
            }
            // Only setup WebRTC if ICE servers provided (for avatar mode)
            // and if we haven't already sent an SDP offer
            if (data.ice_servers && data.ice_servers.length > 0) {
              if (avatarSdpSentRef.current) {
                console.log("SDP already sent, skipping duplicate WebRTC setup");
              } else {
                console.log("ICE servers from Azure:", JSON.stringify(data.ice_servers, null, 2));
                setAvatarStatus("connecting");
                avatarSdpSentRef.current = true;
                const pc = initPeerConnection(data.ice_servers);
                await createAndSendOffer(pc);
              }
            } else {
              console.log("No ICE servers - running in voice-only mode");
              setAvatarStatus("none");
            }
            console.log("=====================");
            break;

          case "avatar.sdp":
            console.log("=== Avatar SDP Response ===");
            // Set remote SDP from Azure
            if (peerConnectionRef.current && data.server_sdp) {
              console.log("Server SDP received, length:", data.server_sdp.length, "chars");
              try {
                await peerConnectionRef.current.setRemoteDescription({
                  type: "answer",
                  sdp: data.server_sdp,
                });
                console.log("Remote SDP set successfully");
                console.log("Signaling state after:", peerConnectionRef.current.signalingState);
              } catch (sdpError) {
                console.error("Failed to set remote SDP:", sdpError);
              }
            } else {
              if (!peerConnectionRef.current) {
                console.error("No peer connection when receiving avatar.sdp");
              }
              if (!data.server_sdp) {
                console.error("No server_sdp in avatar.sdp message. Full data:", data);
              }
            }
            console.log("===========================");
            break;

          case "avatar.connected":
            console.log("Avatar WebRTC connection established");
            setAvatarStatus("connected");
            break;

          case "avatar.error":
            console.error("Avatar connection failed:", data.message);
            setAvatarStatus("failed");
            // Continue with voice-only mode - audio capture already started
            break;

          case "user.speaking.started":
            // Stop any ongoing assistant audio playback (interruption)
            stopAudioPlayback();
            // Reset streaming transcript on interruption
            setStreamingTranscript("");
            setSpeakingState("user");
            break;

          case "user.speaking.stopped":
            setSpeakingState("idle");
            break;

          case "assistant.response.started":
            setSpeakingState("assistant");
            break;

          case "assistant.speaking.done":
          case "assistant.response.done":
          case "assistant.response.cancelled":
            setSpeakingState("idle");
            break;

          case "audio.delta":
            // Play audio chunk (voice-only mode) - use type guard
            if (isAudioDeltaMessage(data) && data.data) {
              playAudioChunk(data.data);
            }
            break;

          case "audio.dropped":
            // Audio was dropped by server (session not ready)
            console.warn("Audio dropped:", data.reason || "unknown reason");
            break;

          case "transcript.delta":
            // Streaming transcript - display word-by-word as it arrives
            if (isTranscriptDeltaMessage(data)) {
              setStreamingTranscript((prev) => prev + data.delta);
            }
            break;

          case "transcript":
            // Use type guard for safe access
            if (isTranscriptMessage(data)) {
              if (data.role === "assistant") {
                // Finalize assistant transcript - use the authoritative text from server
                // Reset streaming state and add the final transcript
                setStreamingTranscript("");
                setTranscripts((prev) => [
                  ...prev,
                  {
                    role: "assistant",
                    text: data.text,
                    timestamp: new Date(),
                  },
                ]);
              } else {
                // User transcript - add directly
                setTranscripts((prev) => [
                  ...prev,
                  {
                    role: data.role,
                    text: data.text,
                    timestamp: new Date(),
                  },
                ]);
              }
            }
            break;

          case "mode.updated":
            // Mode switch confirmed by server
            const newTurnBased = data.turn_based === true;
            setTurnBasedMode(newTurnBased);
            console.log(`Mode confirmed: ${newTurnBased ? "turn-based" : "live voice"}`);
            break;

          case "error":
            console.error("=== Server Error ===");
            if (isErrorMessage(data)) {
              console.error("Message:", data.message);
              if (data.code) {
                console.error("Code:", data.code);
              }
              onError?.(data.message);
            }
            console.error("Full error data:", data);
            console.error("====================");
            setStatus("error");
            break;
        }
      } catch (error) {
        console.error("Error parsing message:", error);
      }
    },
    [initPeerConnection, createAndSendOffer, startAudioCapture, playAudioChunk, stopAudioPlayback, onError]
  );

  // Reconnect with exponential backoff
  const reconnectWithBackoff = useCallback(async () => {
    if (!shouldReconnectRef.current) return;

    const baseDelay = 1000; // 1 second base delay
    const attempt = reconnectAttemptsRef.current;

    if (attempt >= maxReconnectAttempts) {
      console.error(
        `Failed to reconnect after ${maxReconnectAttempts} attempts`
      );
      onError?.("Failed to reconnect after multiple attempts");
      shouldReconnectRef.current = false;
      return;
    }

    const delay = baseDelay * Math.pow(2, attempt);
    console.log(
      `Reconnect attempt ${attempt + 1}/${maxReconnectAttempts} in ${delay}ms`
    );
    setStatus("connecting");

    await new Promise((resolve) => setTimeout(resolve, delay));

    if (!shouldReconnectRef.current) return;

    reconnectAttemptsRef.current += 1;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("WebSocket reconnected");
        reconnectAttemptsRef.current = 0; // Reset on success
        shouldReconnectRef.current = false;
      };

      ws.onmessage = handleMessage;

      ws.onerror = (error) => {
        console.error("WebSocket reconnect error:", error);
        reconnectWithBackoff();
      };

      ws.onclose = () => {
        console.log("WebSocket closed during reconnect");
        if (shouldReconnectRef.current) {
          reconnectWithBackoff();
        } else {
          setStatus("disconnected");
          cleanup();
        }
      };
    } catch (error) {
      console.error("Reconnection error:", error);
      reconnectWithBackoff();
    }
  }, [wsUrl, handleMessage, onError, cleanup, maxReconnectAttempts]);

  // Connect to voice avatar session
  const connect = useCallback(async () => {
    if (status === "connecting" || status === "connected") return;

    setStatus("connecting");
    setTranscripts([]);
    setStreamingTranscript("");
    reconnectAttemptsRef.current = 0;
    shouldReconnectRef.current = true;
    avatarSdpSentRef.current = false;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("WebSocket connected");
        reconnectAttemptsRef.current = 0;
        // Session setup happens automatically on backend
      };

      ws.onmessage = handleMessage;

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        onError?.("WebSocket connection failed");
        setStatus("error");
      };

      ws.onclose = () => {
        console.log("WebSocket closed");
        // Check shouldReconnect flag - it's set when we intend to stay connected
        if (shouldReconnectRef.current) {
          // Unexpected disconnect - attempt reconnection
          console.log("Unexpected disconnect, attempting reconnection...");
          cleanup();
          reconnectWithBackoff();
        } else {
          setStatus("disconnected");
          cleanup();
        }
      };
    } catch (error) {
      console.error("Connection error:", error);
      onError?.("Failed to connect");
      setStatus("error");
    }
  }, [status, wsUrl, handleMessage, onError, cleanup, reconnectWithBackoff]);

  // Send text message to assistant
  const sendTextMessage = useCallback((text: string) => {
    const trimmedText = text.trim();
    if (!trimmedText) return;

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      // Add to transcripts immediately for responsive UI
      setTranscripts((prev) => [
        ...prev,
        {
          role: "user",
          text: trimmedText,
          timestamp: new Date(),
        },
      ]);
      // Send to backend
      wsRef.current.send(
        JSON.stringify({
          type: "text.input",
          text: trimmedText,
        })
      );
      console.log("Text message sent:", trimmedText.substring(0, 50));
    } else {
      console.warn("Cannot send text: WebSocket not open");
      onError?.("Cannot send message: not connected");
    }
  }, [onError]);

  // Trigger assistant response (for turn-based mode)
  const triggerResponse = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "response.trigger" }));
      console.log("Response trigger sent");
    } else {
      console.warn("Cannot trigger response: WebSocket not open");
    }
  }, []);

  // Toggle between turn-based and live voice mode
  const toggleMode = useCallback((turnBased: boolean) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "mode.set",
          turn_based: turnBased,
        })
      );
      // Optimistically update local state
      setTurnBasedMode(turnBased);
      console.log(`Mode toggle sent: ${turnBased ? "turn-based" : "live voice"}`);
    } else {
      console.warn("Cannot toggle mode: WebSocket not open");
      onError?.("Cannot change mode: not connected");
    }
  }, [onError]);

  // Disconnect from session
  const disconnect = useCallback(() => {
    // Stop any reconnection attempts
    shouldReconnectRef.current = false;
    reconnectAttemptsRef.current = 0;
    cleanup();
    setStatus("disconnected");
    setSpeakingState("idle");
    setAvatarStatus("none");
    setStreamingTranscript("");
  }, [cleanup]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    status,
    speakingState,
    transcripts,
    streamingTranscript,
    videoStream,
    audioStream,
    avatarStatus,
    turnBasedMode,
    connect,
    disconnect,
    sendTextMessage,
    triggerResponse,
    toggleMode,
  };
}
