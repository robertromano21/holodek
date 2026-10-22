'use strict';
const zlib = require('node:zlib'), crypto = require('node:crypto');
const MAX_JSON = 256 * 1024 * 1024, MAX_WIRE = 32 * 1024 * 1024;
const types = { Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array };
function pack(value) {
  const bytes = Buffer.from(JSON.stringify(value, (key, item) => {
    if (ArrayBuffer.isView(item) && types[item.constructor.name]) return { __holodekTyped: item.constructor.name,
      bytes: Buffer.from(item.buffer, item.byteOffset, item.byteLength).toString('base64') };
    return item;
  }));
  if (bytes.length > MAX_JSON) throw Error('Room work order exceeds the unpacked limit.');
  const compressed = zlib.gzipSync(bytes);
  if (compressed.length > MAX_WIRE) throw Error('Room work order exceeds the transfer limit.');
  return { encoding: 'gzip-json-v1', bytes: compressed.toString('base64'),
    sha256: crypto.createHash('sha256').update(compressed).digest('hex') };
}
function unpack(packet) {
  if (packet?.encoding !== 'gzip-json-v1' || !/^[a-f0-9]{64}$/.test(packet.sha256 || '') ||
      typeof packet.bytes !== 'string' || packet.bytes.length > Math.ceil(MAX_WIRE / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(packet.bytes)) throw Error('Invalid room transfer.');
  const compressed = Buffer.from(packet.bytes, 'base64');
  if (crypto.createHash('sha256').update(compressed).digest('hex') !== packet.sha256) throw Error('Room transfer checksum mismatch.');
  const bytes = zlib.gunzipSync(compressed, { maxOutputLength: MAX_JSON });
  return JSON.parse(bytes.toString('utf8'), (key, value) => {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw Error('Unsafe room field.');
    if (!value?.__holodekTyped) return value;
    if (!Object.hasOwn(types, value.__holodekTyped) || typeof value.bytes !== 'string') throw Error('Invalid room array.');
    const Type = types[value.__holodekTyped], decoded = Buffer.from(value.bytes, 'base64');
    if (decoded.toString('base64') !== value.bytes) throw Error('Invalid room array encoding.');
    const data = Uint8Array.from(decoded);
    if (data.length % Type.BYTES_PER_ELEMENT) throw Error('Invalid room array size.');
    return new Type(data.buffer);
  });
}
module.exports = { pack, unpack, MAX_JSON, MAX_WIRE };
