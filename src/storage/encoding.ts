// Shared utilities for encoding/decoding raw bytes in browser storage
import { base64ToUint8Array, Uint8ArrayToBase64, Uint8ArrayToString } from "@freedomofpress/crypto-browser";

import { Metafile } from "../types.js";

export function isRawBytesWrapper(
  value: unknown,
): value is { __raw_bytes__: string } {
  return (
    value != null &&
    typeof value === "object" &&
    "__raw_bytes__" in value &&
    typeof (value as { __raw_bytes__: unknown }).__raw_bytes__ === "string"
  );
}

export function decodeRawBytesWrapper(wrapper: {
  __raw_bytes__: string;
}): Metafile {
  const bytes = base64ToUint8Array(wrapper.__raw_bytes__);
  return JSON.parse(Uint8ArrayToString(bytes));
}

export function createRawBytesWrapper(value: Uint8Array): {
  __raw_bytes__: string;
} {
  return { __raw_bytes__: Uint8ArrayToBase64(value) };
}

// Legacy object caches were written with JSON.stringify; raw wrappers retain
// the exact downloaded bytes, including insignificant whitespace.
export function storedBytes(value: unknown): Uint8Array | undefined {
  if (value === undefined || value === null) return undefined;
  return isRawBytesWrapper(value) ? base64ToUint8Array(value.__raw_bytes__)
    : new TextEncoder().encode(JSON.stringify(value));
}
