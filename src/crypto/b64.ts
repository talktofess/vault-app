// Portable base64 for Uint8Array — works in Node and React Native without
// depending on Buffer or a working global btoa/atob (RN's are unreliable for
// binary). Used to store ciphertext/nonces as JSON-safe strings.

const CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = (() => {
  const t = new Uint8Array(256);
  for (let i = 0; i < CHARS.length; i++) t[CHARS.charCodeAt(i)] = i;
  return t;
})();

export function toB64(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      CHARS[(n >> 18) & 63] +
      CHARS[(n >> 12) & 63] +
      CHARS[(n >> 6) & 63] +
      CHARS[n & 63];
  }
  if (i < bytes.length) {
    const rem = bytes.length - i;
    if (rem === 1) {
      const n = bytes[i] << 16;
      out += CHARS[(n >> 18) & 63] + CHARS[(n >> 12) & 63] + "==";
    } else {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
      out += CHARS[(n >> 18) & 63] + CHARS[(n >> 12) & 63] + CHARS[(n >> 6) & 63] + "=";
    }
  }
  return out;
}

export function fromB64(str: string): Uint8Array {
  let len = str.length;
  if (len === 0) return new Uint8Array(0);
  let pad = 0;
  if (str[len - 1] === "=") pad++;
  if (str[len - 2] === "=") pad++;
  const outLen = (len / 4) * 3 - pad;
  const out = new Uint8Array(outLen);
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const n =
      (LOOKUP[str.charCodeAt(i)] << 18) |
      (LOOKUP[str.charCodeAt(i + 1)] << 12) |
      (LOOKUP[str.charCodeAt(i + 2)] << 6) |
      LOOKUP[str.charCodeAt(i + 3)];
    if (p < outLen) out[p++] = (n >> 16) & 255;
    if (p < outLen) out[p++] = (n >> 8) & 255;
    if (p < outLen) out[p++] = n & 255;
  }
  return out;
}

export function utf8ToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function bytesToUtf8(b: Uint8Array): string {
  return new TextDecoder().decode(b);
}
