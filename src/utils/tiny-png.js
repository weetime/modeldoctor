const zlib = require("zlib");

// Precomputed CRC-32 table (IEEE polynomial 0xedb88320) — PNG uses this.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(tag, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const tagBuf = Buffer.from(tag, "binary");
  const crcIn = Buffer.concat([tagBuf, data]);
  const crcOut = Buffer.alloc(4);
  crcOut.writeUInt32BE(crc32(crcIn), 0);
  return Buffer.concat([len, tagBuf, data, crcOut]);
}

/**
 * Generates a minimal 8x8 solid-color PNG (stdlib only).
 * @param {[number, number, number]} rgb - 0-255 channel values. Default: pure red.
 * @returns {Buffer} PNG bytes.
 */
function makeSolidPng(rgb = [255, 0, 0]) {
  const [r, g, b] = rgb;
  const w = 8;
  const h = 8;
  const rows = [];
  for (let i = 0; i < h; i++) {
    rows.push(Buffer.from([0x00])); // filter: none
    for (let j = 0; j < w; j++) rows.push(Buffer.from([r, g, b]));
  }
  const raw = Buffer.concat(rows);

  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // color type RGB
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  const idat = zlib.deflateSync(raw);
  return Buffer.concat([header, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

module.exports = { makeSolidPng };
