// Forwards microphone audio from the audio thread to the main thread in mono chunks.
class PsstCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = new Float32Array(2048);
    this.filled = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0 && input[0]) {
      const channels = input.length;
      const frames = input[0].length;
      for (let i = 0; i < frames; i++) {
        let sample = input[0][i];
        if (channels > 1) {
          for (let c = 1; c < channels; c++) sample += input[c][i];
          sample /= channels;
        }
        this.chunk[this.filled++] = sample;
        if (this.filled === this.chunk.length) {
          this.port.postMessage(this.chunk, [this.chunk.buffer]);
          this.chunk = new Float32Array(2048);
          this.filled = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("psst-capture", PsstCaptureProcessor);
