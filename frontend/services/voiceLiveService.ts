/**
 * VoiceLive WebSocket Service
 *
 * Handles WebSocket communication with the FastAPI backend
 * which proxies to Azure VoiceLive.
 */

export type InteractionMode = 'text' | 'push-to-talk' | 'realtime';

export interface WebSocketMessage {
  type: string;
  [key: string]: unknown;
}

export interface SessionReadyMessage extends WebSocketMessage {
  type: 'session.ready';
  ice_servers: RTCIceServer[];
}

export interface AvatarSdpMessage extends WebSocketMessage {
  type: 'avatar.sdp';
  server_sdp: string;
}

export interface TranscriptMessage extends WebSocketMessage {
  type: 'transcript';
  role: 'user' | 'assistant';
  text: string;
}

export interface RagSourcesMessage extends WebSocketMessage {
  type: 'rag.sources';
  sources: Array<{ title: string; url?: string }>;
}

export interface ErrorMessage extends WebSocketMessage {
  type: 'error';
  message: string;
  code?: string;
}

type MessageHandler = (message: WebSocketMessage) => void;

export class VoiceLiveService {
  private ws: WebSocket | null = null;
  private messageHandlers: Set<MessageHandler> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private _isConnected = false;

  get isConnected(): boolean {
    return this._isConnected && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Connect to the VoiceLive WebSocket backend
   */
  async connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        console.log('[VoiceLive] Connecting to:', url);
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          console.log('[VoiceLive] WebSocket connected');
          this._isConnected = true;
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onclose = (event) => {
          console.log('[VoiceLive] WebSocket closed:', event.code, event.reason);
          this._isConnected = false;
          this.notifyHandlers({
            type: 'connection.closed',
            code: event.code,
            reason: event.reason
          });
        };

        this.ws.onerror = (error) => {
          console.error('[VoiceLive] WebSocket error:', error);
          this._isConnected = false;
          reject(error);
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data) as WebSocketMessage;
            this.handleMessage(message);
          } catch (e) {
            console.error('[VoiceLive] Failed to parse message:', e);
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the WebSocket
   */
  disconnect(): void {
    if (this.ws) {
      console.log('[VoiceLive] Disconnecting...');
      this.ws.close();
      this.ws = null;
      this._isConnected = false;
    }
  }

  /**
   * Send audio data (base64 PCM16)
   */
  sendAudio(pcmBase64: string): void {
    this.send({ type: 'audio', data: pcmBase64 });
  }

  /**
   * Send text message (text chat mode)
   */
  sendText(text: string): void {
    this.send({ type: 'text.input', text });
  }

  /**
   * Commit audio buffer (push-to-talk release)
   */
  sendAudioCommit(): void {
    this.send({ type: 'audio.commit' });
  }

  /**
   * Clear audio buffer (push-to-talk start)
   */
  sendAudioClear(): void {
    this.send({ type: 'audio.clear' });
  }

  /**
   * Set interaction mode
   */
  setMode(mode: InteractionMode): void {
    this.send({ type: 'mode.set', mode });
  }

  /**
   * Send WebRTC SDP offer for avatar video
   */
  sendAvatarSdp(sdp: string): void {
    this.send({ type: 'avatar.sdp', sdp });
  }

  /**
   * Register a message handler
   */
  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  private send(message: WebSocketMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('[VoiceLive] Cannot send message - not connected');
    }
  }

  private handleMessage(message: WebSocketMessage): void {
    // Log non-audio messages
    if (message.type !== 'audio.delta' && message.type !== 'audio.timestamp') {
      console.log('[VoiceLive] Received:', message.type);
    }
    this.notifyHandlers(message);
  }

  private notifyHandlers(message: WebSocketMessage): void {
    this.messageHandlers.forEach(handler => {
      try {
        handler(message);
      } catch (e) {
        console.error('[VoiceLive] Handler error:', e);
      }
    });
  }
}

// Singleton instance
let instance: VoiceLiveService | null = null;

export function getVoiceLiveService(): VoiceLiveService {
  if (!instance) {
    instance = new VoiceLiveService();
  }
  return instance;
}

export function createVoiceLiveService(): VoiceLiveService {
  return new VoiceLiveService();
}
