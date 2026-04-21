/**
 * Validates the RIFF/WAVE magic bytes at the start of an audio payload.
 * @param {Buffer} buf
 * @returns {boolean}
 */
function isValidWav(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 44) return false;
  return (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && // "RIFF"
    buf[8] === 0x57 && buf[9] === 0x41 && buf[10] === 0x56 && buf[11] === 0x45    // "WAVE"
  );
}

module.exports = { isValidWav };
