/**
 * Audio utility functions for PCM16/Base64 conversion.
 *
 * These functions handle the conversion between browser AudioContext float32 format
 * and the PCM16 base64 format expected by Azure VoiceLive.
 */

// Audio configuration constants matching VoiceLive expectations
export const SAMPLE_RATE = 24000;
export const CHANNELS = 1;

/**
 * Decode base64 PCM16 audio data to Float32Array.
 *
 * @param base64Data - Base64 encoded PCM16 audio data
 * @returns Float32Array suitable for AudioContext playback
 */
export function decodeBase64ToPCM16(base64Data: string): Float32Array {
  // Decode base64 to bytes
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Convert PCM16 (Int16) to Float32 (-1.0 to 1.0 range)
  const int16Array = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16Array.length);
  for (let i = 0; i < int16Array.length; i++) {
    float32[i] = int16Array[i] / 32768;
  }

  return float32;
}

/**
 * Encode Float32Array audio data to base64 PCM16.
 *
 * @param float32 - Float32Array from AudioContext (-1.0 to 1.0 range)
 * @returns Base64 encoded PCM16 audio data
 */
export function encodePCM16ToBase64(float32: Float32Array): string {
  // Convert Float32 to Int16 PCM
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    // Clamp to -1.0 to 1.0 range, then scale to Int16 range
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  // Convert to base64
  const bytes = new Uint8Array(int16.buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
}

/**
 * Create an AudioBuffer from Float32 PCM data.
 *
 * @param ctx - AudioContext to create buffer with
 * @param float32 - Float32Array of audio samples
 * @returns AudioBuffer ready for playback
 */
export function createAudioBuffer(
  ctx: AudioContext,
  float32: Float32Array
): AudioBuffer {
  const audioBuffer = ctx.createBuffer(CHANNELS, float32.length, SAMPLE_RATE);
  audioBuffer.getChannelData(0).set(float32);
  return audioBuffer;
}
