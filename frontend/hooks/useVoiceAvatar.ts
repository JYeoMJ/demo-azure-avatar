"use client";

import { useState, useRef, useCallback, useEffect } from "react";

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
}

interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

const DEFAULT_WS_URL =
  process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000/ws/voice-avatar";

// Audio configuration to match VoiceLive expectations
const SAMPLE_RATE = 24000;
const CHANNELS = 1;

export function useVoiceAvatar(options: UseVoiceAvatarOptions = {}) {
  const { wsUrl = DEFAULT_WS_URL, onError } = options;

  // State
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [speakingState, setSpeakingState] = useState<SpeakingState>("idle");
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [avatarStatus, setAvatarStatus] = useState<"none" | "connecting" | "connected" | "failed">("none");

  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  // Audio playback refs (for voice-only mode)
  const playbackContextRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef = useRef<boolean>(false);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);

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
  }, []);

  // Play audio from base64 PCM16 data (voice-only mode)
  const playAudioChunk = useCallback(async (base64Data: string) => {
    try {
      // Create playback context if needed
      if (!playbackContextRef.current) {
        playbackContextRef.current = new AudioContext({ sampleRate: SAMPLE_RATE });
      }
      const ctx = playbackContextRef.current;

      // Decode base64 to PCM16
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Convert PCM16 to Float32
      const pcm16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) {
        float32[i] = pcm16[i] / 32768;
      }

      // Create audio buffer
      const audioBuffer = ctx.createBuffer(1, float32.length, SAMPLE_RATE);
      audioBuffer.getChannelData(0).set(float32);

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
              resolve();
            }
          };
          pc.onicegatheringstatechange = checkState;
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
      const processor = audioContext.createScriptProcessor(4096, CHANNELS, CHANNELS);

      processor.onaudioprocess = (e) => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          const inputData = e.inputBuffer.getChannelData(0);

          // Convert float32 to int16 PCM
          const pcm16 = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }

          // Convert to base64
          const base64 = btoa(
            String.fromCharCode(...new Uint8Array(pcm16.buffer))
          );

          // Send to backend
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
            await startAudioCapture();
            // Only setup WebRTC if ICE servers provided (for avatar mode)
            if (data.ice_servers && data.ice_servers.length > 0) {
              console.log("ICE servers from Azure:", JSON.stringify(data.ice_servers, null, 2));
              setAvatarStatus("connecting");
              const pc = initPeerConnection(data.ice_servers);
              await createAndSendOffer(pc);
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
            // Play audio chunk (voice-only mode)
            if (data.data) {
              playAudioChunk(data.data);
            }
            break;

          case "transcript":
            setTranscripts((prev) => [
              ...prev,
              {
                role: data.role as "user" | "assistant",
                text: data.text,
                timestamp: new Date(),
              },
            ]);
            break;

          case "error":
            console.error("=== Server Error ===");
            console.error("Message:", data.message);
            if (data.code) {
              console.error("Code:", data.code);
            }
            console.error("Full error data:", data);
            console.error("====================");
            onError?.(data.message);
            setStatus("error");
            break;
        }
      } catch (error) {
        console.error("Error parsing message:", error);
      }
    },
    [initPeerConnection, createAndSendOffer, startAudioCapture, playAudioChunk, stopAudioPlayback, onError]
  );

  // Connect to voice avatar session
  const connect = useCallback(async () => {
    if (status === "connecting" || status === "connected") return;

    setStatus("connecting");
    setTranscripts([]);

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("WebSocket connected");
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
        setStatus("disconnected");
        cleanup();
      };
    } catch (error) {
      console.error("Connection error:", error);
      onError?.("Failed to connect");
      setStatus("error");
    }
  }, [status, wsUrl, handleMessage, onError, cleanup]);

  // Disconnect from session
  const disconnect = useCallback(() => {
    cleanup();
    setStatus("disconnected");
    setSpeakingState("idle");
    setAvatarStatus("none");
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
    videoStream,
    audioStream,
    avatarStatus,
    connect,
    disconnect,
  };
}
