/** Encodes mono float samples (-1..1) as a 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/** Joins clips with a short pause between them. */
export function concatWithGap(clips: Float32Array[], sampleRate: number, gapSeconds: number): Float32Array {
  if (clips.length === 1) return clips[0];
  const gap = Math.round(sampleRate * gapSeconds);
  const total = clips.reduce((n, c) => n + c.length, 0) + gap * (clips.length - 1);
  const out = new Float32Array(total);
  let offset = 0;
  clips.forEach((clip, i) => {
    out.set(clip, offset);
    offset += clip.length + (i < clips.length - 1 ? gap : 0);
  });
  return out;
}

/** A looping, inaudible clip used to keep a media session alive for headphone buttons. */
export function makeSilentWav(seconds: number): Blob {
  const rate = 8000;
  const samples = new Float32Array(rate * seconds);
  for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() - 0.5) * 0.00006;
  return encodeWav(samples, rate);
}
