export enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR'
}

export enum InteractionMode {
  TEXT_CHAT = 'TEXT_CHAT',
  REALTIME_VOICE = 'REALTIME_VOICE'
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
}

export interface AvatarConfig {
  name: string;
  role: string;
  avatarUrl: string;
  status: 'active' | 'idle' | 'listening' | 'speaking';
}

export interface AudioConfig {
  sampleRate: number;
}

// VoiceLive WebSocket Message Types
export type VoiceLiveMessageType =
  | 'session.ready'
  | 'avatar.sdp'
  | 'avatar.connected'
  | 'avatar.error'
  | 'transcript'
  | 'user.speaking.started'
  | 'user.speaking.stopped'
  | 'assistant.response.started'
  | 'assistant.speaking.done'
  | 'assistant.response.done'
  | 'assistant.response.cancelled'
  | 'audio.delta'
  | 'audio.timestamp'
  | 'mode.changed'
  | 'rag.started'
  | 'rag.sources'
  | 'rag.error'
  | 'connection.closed'
  | 'error';

export interface VoiceLiveMessage {
  type: VoiceLiveMessageType;
  [key: string]: unknown;
}

export interface SessionReadyMessage extends VoiceLiveMessage {
  type: 'session.ready';
  ice_servers: RTCIceServer[];
}

export interface AvatarSdpMessage extends VoiceLiveMessage {
  type: 'avatar.sdp';
  server_sdp: string;
}

export interface TranscriptMessage extends VoiceLiveMessage {
  type: 'transcript';
  role: 'user' | 'assistant';
  text: string;
}

export interface AudioDeltaMessage extends VoiceLiveMessage {
  type: 'audio.delta';
  data: string; // base64 PCM16
}

export interface RagSourcesMessage extends VoiceLiveMessage {
  type: 'rag.sources';
  sources: Array<{ title: string; url?: string }>;
}

export interface ErrorMessage extends VoiceLiveMessage {
  type: 'error';
  message: string;
  code?: string;
}

// Avatar Status for video streaming
export type AvatarStatus = 'none' | 'connecting' | 'connected' | 'failed';

// Speaking State
export type SpeakingState = 'idle' | 'user' | 'assistant';
