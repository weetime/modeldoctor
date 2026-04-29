/**
 * WAV helpers.
 *
 * Ported verbatim from the legacy CJS util (src/utils/wav.js).
 * The legacy file only exposed a `isValidWav` validator; no synthesiser lived
 * there. Additional synthesis helpers will be added alongside the audio probe
 * in a later task if needed.
 */

/**
 * Validates the RIFF/WAVE magic bytes at the start of an audio payload.
 * Returns false for non-Buffers, short buffers, or missing magic.
 */
export function isValidWav(buf: unknown): boolean {
  if (!Buffer.isBuffer(buf) || buf.length < 44) return false;
  return (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 && // "RIFF"
    buf[8] === 0x57 &&
    buf[9] === 0x41 &&
    buf[10] === 0x56 &&
    buf[11] === 0x45 // "WAVE"
  );
}

export type AudioFormat = "wav" | "mp3" | "ogg" | "flac" | "unknown";

/**
 * Magic-bytes sniff. Catches the common formats OpenAI's /v1/audio/speech
 * may emit (wav | mp3 | flac | opus/ogg) without parsing the full container.
 */
export function detectAudioFormat(buf: Buffer | Uint8Array): AudioFormat {
  if (buf.length < 4) return "unknown";
  // WAV: "RIFF...WAVE"
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf.length >= 12 &&
    buf[8] === 0x57 &&
    buf[9] === 0x41 &&
    buf[10] === 0x56 &&
    buf[11] === 0x45
  ) {
    return "wav";
  }
  // MP3: "ID3" tag OR 0xFFFB / 0xFFF3 / 0xFFF2 frame sync
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return "mp3";
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return "mp3";
  // Ogg: "OggS"
  if (buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) return "ogg";
  // FLAC: "fLaC"
  if (buf[0] === 0x66 && buf[1] === 0x4c && buf[2] === 0x61 && buf[3] === 0x43) return "flac";
  return "unknown";
}
