/**
 * WebRTC Service for Avatar Video Streaming
 *
 * Manages the WebRTC peer connection for receiving
 * avatar video and audio from Azure VoiceLive.
 */

type TrackHandler = (stream: MediaStream) => void;
type ConnectionStateHandler = (state: RTCPeerConnectionState) => void;

export class WebRTCService {
  private pc: RTCPeerConnection | null = null;
  private videoHandler: TrackHandler | null = null;
  private audioHandler: TrackHandler | null = null;
  private connectionStateHandler: ConnectionStateHandler | null = null;
  private _isConnected = false;

  get isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Initialize the peer connection with ICE servers
   */
  init(iceServers: RTCIceServer[]): void {
    console.log('[WebRTC] Initializing with ICE servers:', iceServers.length);

    // Close existing connection if any
    this.close();

    const config: RTCConfiguration = {
      iceServers: iceServers.length > 0 ? iceServers : [
        { urls: 'stun:stun.l.google.com:19302' }
      ],
      iceTransportPolicy: iceServers.length > 0 ? 'relay' : 'all'
    };

    this.pc = new RTCPeerConnection(config);

    // Add transceivers for receiving video and audio
    this.pc.addTransceiver('video', { direction: 'recvonly' });
    this.pc.addTransceiver('audio', { direction: 'recvonly' });

    // Handle incoming tracks
    this.pc.ontrack = (event) => {
      console.log('[WebRTC] Track received:', event.track.kind);

      if (event.track.kind === 'video' && this.videoHandler) {
        const stream = new MediaStream([event.track]);
        this.videoHandler(stream);
      } else if (event.track.kind === 'audio' && this.audioHandler) {
        const stream = new MediaStream([event.track]);
        this.audioHandler(stream);
      }
    };

    // Monitor connection state
    this.pc.onconnectionstatechange = () => {
      const state = this.pc?.connectionState;
      console.log('[WebRTC] Connection state:', state);

      if (state === 'connected') {
        this._isConnected = true;
      } else if (
        state === 'disconnected' ||
        state === 'failed' ||
        state === 'closed'
      ) {
        this._isConnected = false;
      }

      // Notify handler of state change
      if (state && this.connectionStateHandler) {
        this.connectionStateHandler(state);
      }
    };

    // Log ICE connection state
    this.pc.oniceconnectionstatechange = () => {
      console.log('[WebRTC] ICE state:', this.pc?.iceConnectionState);
    };

    // Log ICE gathering state
    this.pc.onicegatheringstatechange = () => {
      console.log('[WebRTC] ICE gathering state:', this.pc?.iceGatheringState);
    };
  }

  /**
   * Create and return the SDP offer
   * Waits for ICE gathering to complete before returning
   */
  async createOffer(): Promise<string> {
    if (!this.pc) {
      throw new Error('Peer connection not initialized');
    }

    console.log('[WebRTC] Creating offer...');

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    // Wait for ICE gathering to complete
    await this.waitForIceGathering();

    const localSdp = this.pc.localDescription?.sdp;
    if (!localSdp) {
      throw new Error('Failed to get local SDP');
    }

    console.log('[WebRTC] Offer created, SDP length:', localSdp.length);
    return localSdp;
  }

  /**
   * Set the remote SDP answer from the server
   */
  async setRemoteAnswer(sdp: string): Promise<void> {
    if (!this.pc) {
      throw new Error('Peer connection not initialized');
    }

    console.log('[WebRTC] Setting remote answer, SDP length:', sdp.length);

    await this.pc.setRemoteDescription({
      type: 'answer',
      sdp
    });

    console.log('[WebRTC] Remote answer set');
  }

  /**
   * Register handler for video track
   */
  onVideoTrack(handler: TrackHandler): void {
    this.videoHandler = handler;
  }

  /**
   * Register handler for audio track
   */
  onAudioTrack(handler: TrackHandler): void {
    this.audioHandler = handler;
  }

  /**
   * Register handler for connection state changes
   */
  onConnectionStateChange(handler: ConnectionStateHandler): void {
    this.connectionStateHandler = handler;
  }

  /**
   * Close the peer connection
   */
  close(): void {
    if (this.pc) {
      console.log('[WebRTC] Closing connection');
      this.pc.close();
      this.pc = null;
      this._isConnected = false;
    }
  }

  private waitForIceGathering(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.pc) {
        resolve();
        return;
      }

      if (this.pc.iceGatheringState === 'complete') {
        resolve();
        return;
      }

      const checkState = () => {
        if (this.pc?.iceGatheringState === 'complete') {
          this.pc.removeEventListener('icegatheringstatechange', checkState);
          resolve();
        }
      };

      this.pc.addEventListener('icegatheringstatechange', checkState);

      // Timeout after 5 seconds
      setTimeout(() => {
        if (this.pc) {
          this.pc.removeEventListener('icegatheringstatechange', checkState);
        }
        resolve();
      }, 5000);
    });
  }
}

// Factory function
export function createWebRTCService(): WebRTCService {
  return new WebRTCService();
}
