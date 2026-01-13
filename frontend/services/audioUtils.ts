/**
 * Audio utilities for PCM encoding/decoding
 *
 * Azure VoiceLive uses 24kHz PCM16 audio format.
 */

// VoiceLive requires 24kHz sample rate
export const VOICELIVE_SAMPLE_RATE = 24000;

/**
 * Encodes Uint8Array to base64 string
 */
export function encodeAudio(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Decodes base64 string to Uint8Array
 */
export function decodeAudio(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Converts raw PCM16 data to AudioBuffer for playback
 */
export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = VOICELIVE_SAMPLE_RATE,
  numChannels: number = 1,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      // Convert Int16 to Float32 [-1.0, 1.0]
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

/**
 * Converts Float32Array from microphone to base64 PCM16
 * Ready to send to VoiceLive via WebSocket
 */
export function createPcmBase64(data: Float32Array): string {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    // Clamp values to [-1, 1]
    const s = Math.max(-1, Math.min(1, data[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return encodeAudio(new Uint8Array(int16.buffer));
}

/**
 * Calculates RMS (Root Mean Square) audio level from Float32Array
 * Returns a value between 0 and 1
 */
export function calculateRmsLevel(data: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i] * data[i];
  }
  const rms = Math.sqrt(sum / data.length);
  // Normalize to 0-1 range (typical speech peaks around 0.3-0.5)
  return Math.min(1, rms * 2);
}
