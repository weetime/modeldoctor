/**
 * Shared data URL / Blob conversion helpers.
 *
 * Used by:
 *  - apps/web/src/features/playground/chat/ChatPage.tsx (Task 9: chat history IDB)
 *  - apps/web/src/features/playground/chat-compare/… (Task 12: compare snapshot IDB)
 */

/**
 * Convert a data URL (e.g. `data:image/png;base64,...`) to a Blob.
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  if (!dataUrl.startsWith("data:")) {
    throw new TypeError(`dataUrlToBlob: expected a data URL, got "${dataUrl.slice(0, 32)}..."`);
  }
  const [header, b64] = dataUrl.split(",", 2);
  const mime = header.replace(/^data:/, "").replace(/;base64$/, "");
  const bytes = atob(b64 ?? "");
  const buf = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    buf[i] = bytes.charCodeAt(i);
  }
  return new Blob([buf], { type: mime });
}

/**
 * Convert raw base64 (no `data:` prefix) to a Blob.
 * Used for `input_audio.data` which is plain base64 rather than a data URL.
 */
export function base64ToBlob(b64: string, mime: string): Blob {
  const bytes = atob(b64);
  const buf = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    buf[i] = bytes.charCodeAt(i);
  }
  return new Blob([buf], { type: mime });
}

/**
 * Convert a Blob to a data URL (async, uses FileReader).
 */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}
