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

// Hand-rolled UTF-8, deliberately NOT using TextEncoder/TextDecoder: Hermes
// (the RN engine) ships TextEncoder but NOT TextDecoder, so `new TextDecoder()`
// throws on-device. Because create() only encodes while unlock() decodes, that
// gap made every re-login fail with "wrong PIN" while onboarding worked. These
// pure-JS versions behave identically on Hermes, Node, and the browser.

export function utf8ToBytes(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let code = s.charCodeAt(i);
    // combine a surrogate pair into a single code point
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < s.length) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }
  return new Uint8Array(out);
}

export function bytesToUtf8(b: Uint8Array): string {
  let out = "";
  let i = 0;
  while (i < b.length) {
    const b1 = b[i++];
    if (b1 < 0x80) {
      out += String.fromCharCode(b1);
    } else if (b1 < 0xe0) {
      const b2 = b[i++] & 0x3f;
      out += String.fromCharCode(((b1 & 0x1f) << 6) | b2);
    } else if (b1 < 0xf0) {
      const b2 = b[i++] & 0x3f;
      const b3 = b[i++] & 0x3f;
      out += String.fromCharCode(((b1 & 0x0f) << 12) | (b2 << 6) | b3);
    } else {
      const b2 = b[i++] & 0x3f;
      const b3 = b[i++] & 0x3f;
      const b4 = b[i++] & 0x3f;
      const code = (((b1 & 0x07) << 18) | (b2 << 12) | (b3 << 6) | b4) - 0x10000;
      out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
    }
  }
  return out;
}
