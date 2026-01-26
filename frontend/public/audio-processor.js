/**
 * Audio Worklet Processor for PCM16 encoding.
 *
 * This processor runs on the audio thread, converting Float32 audio data
 * to PCM16 format for transmission to the backend. It replaces the deprecated
 * ScriptProcessorNode for better performance and lower latency.
 *
 * The processor collects samples into buffers of a target size before sending
 * to reduce message overhead.
 */

class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Buffer to accumulate samples - 1200 samples = 50ms at 24kHz (matches reference SDK)
    // Smaller chunks reduce latency and create smoother network traffic patterns
    this.buffer = new Float32Array(1200);
    this.bufferIndex = 0;
  }

  /**
   * Process audio data from input to output.
   *
   * @param {Float32Array[][]} inputs - Input audio data (channels x samples)
   * @param {Float32Array[][]} outputs - Output audio data (unused)
   * @param {Object} parameters - Audio parameters (unused)
   * @returns {boolean} - True to keep processor alive
   */
  process(inputs, outputs, parameters) {
    const input = inputs[0];

    // Check if we have input data
    if (!input || !input[0] || input[0].length === 0) {
      return true;
    }

    const channelData = input[0];

    // Add samples to buffer
    for (let i = 0; i < channelData.length; i++) {
      this.buffer[this.bufferIndex++] = channelData[i];

      // When buffer is full, convert to PCM16 and send
      if (this.bufferIndex >= this.buffer.length) {
        this.sendBuffer();
      }
    }

    return true;
  }

  /**
   * Convert accumulated Float32 buffer to PCM16 and send to main thread.
   */
  sendBuffer() {
    // Convert Float32 (-1.0 to 1.0) to Int16 (-32768 to 32767)
    const int16 = new Int16Array(this.bufferIndex);
    for (let i = 0; i < this.bufferIndex; i++) {
      // Clamp to -1.0 to 1.0 range
      const s = Math.max(-1, Math.min(1, this.buffer[i]));
      // Scale to Int16 range
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    // Transfer the buffer to main thread (transferable for zero-copy)
    this.port.postMessage(int16.buffer, [int16.buffer]);

    // Reset buffer index
    this.bufferIndex = 0;
  }
}

// Register the processor with the AudioWorklet system
registerProcessor("pcm-processor", PCMProcessor);
