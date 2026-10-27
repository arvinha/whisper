/** Streaming downsampler (box-filter average), e.g. 48 kHz to 16 kHz for speech recognition. */
export class Downsampler {
  readonly outRate: number;
  private readonly ratio: number;
  private carry = new Float32Array(0);
  private offset = 0;

  constructor(inRate: number, targetRate = 16000) {
    this.outRate = Math.min(inRate, targetRate);
    this.ratio = inRate / this.outRate;
  }

  process(input: Float32Array): Float32Array {
    if (this.ratio === 1) return input.slice();

    const data = new Float32Array(this.carry.length + input.length);
    data.set(this.carry, 0);
    data.set(input, this.carry.length);

    const maxOut = Math.floor((data.length - this.offset) / this.ratio);
    const out = new Float32Array(Math.max(0, maxOut));
    let pos = this.offset;
    let n = 0;
    while (n < out.length && pos + this.ratio <= data.length) {
      const end = pos + this.ratio;
      const from = Math.floor(pos);
      const to = Math.min(data.length, Math.ceil(end));
      let sum = 0;
      for (let i = from; i < to; i++) sum += data[i];
      out[n++] = to > from ? sum / (to - from) : 0;
      pos = end;
    }

    const keepFrom = Math.floor(pos);
    this.carry = data.slice(keepFrom);
    this.offset = pos - keepFrom;
    return n === out.length ? out : out.slice(0, n);
  }
}
