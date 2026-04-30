/**
 * Generic helpers to strip binary attachments from ChatMessage arrays into IDB
 * blobs (replacing inline data with `idb://<key>` sentinels) and to reverse
 * the process on restore.
 *
 * The helpers are parameterised by a key-prefix so callers can namespace blobs
 * by panel, modality, etc.  Compare uses `"panel0.msg0.part0"`, single-chat
 * uses `"msg0.part0"`.
 *
 * Consumers:
 *   - apps/web/src/features/playground/chat/ChatPage.tsx
 *   - apps/web/src/features/playground/chat-compare/CompareHistory.tsx
 */

import { base64ToBlob, blobToDataUrl, dataUrlToBlob } from "@/lib/dataUrl";
import type { ChatMessage, ChatMessageContentPart } from "@modeldoctor/contracts";

export const IDB_PREFIX = "idb://";

export interface BlobStore {
  putBlob(entryId: string, key: string, blob: Blob): Promise<void>;
  getBlob(entryId: string, key: string): Promise<Blob | null>;
}

/**
 * Walk `messages`, store each binary content part as a Blob, and replace
 * inline data with an `idb://<keyPrefix>msg{i}.part{j}` sentinel.
 *
 * Returns a new messages array safe for JSON serialisation.
 *
 * @param entryId   History entry ID — used as the IDB blob namespace.
 * @param messages  Messages to sanitise (not mutated; deep-cloned internally).
 * @param store     Blob storage interface (`putBlob` / `getBlob`).
 * @param keyPrefix Optional prefix prepended to every blob key, e.g. `"panel0."`.
 */
export async function persistMessageAttachments(
  entryId: string,
  messages: ChatMessage[],
  store: BlobStore,
  keyPrefix = "",
): Promise<ChatMessage[]> {
  const out = structuredClone(messages) as ChatMessage[];

  for (let i = 0; i < out.length; i++) {
    const m = out[i];
    if (typeof m.content === "string") continue;

    const promises: Array<Promise<{ j: number; part: ChatMessageContentPart }>> = [];

    for (let j = 0; j < m.content.length; j++) {
      const p = m.content[j];
      const key = `${keyPrefix}msg${i}.part${j}`;

      if (p.type === "image_url" && p.image_url.url.startsWith("data:")) {
        promises.push(
          (async () => {
            const blob = dataUrlToBlob(p.image_url.url);
            await store.putBlob(entryId, key, blob);
            return {
              j,
              part: { ...p, image_url: { url: `${IDB_PREFIX}${key}` } } as ChatMessageContentPart,
            };
          })(),
        );
      } else if (
        p.type === "input_audio" &&
        p.input_audio.data &&
        !p.input_audio.data.startsWith(IDB_PREFIX)
      ) {
        promises.push(
          (async () => {
            const blob = base64ToBlob(p.input_audio.data, `audio/${p.input_audio.format}`);
            await store.putBlob(entryId, key, blob);
            return {
              j,
              part: {
                ...p,
                input_audio: { ...p.input_audio, data: `${IDB_PREFIX}${key}` },
              } as ChatMessageContentPart,
            };
          })(),
        );
      } else if (p.type === "input_file" && p.file.file_data.startsWith("data:")) {
        promises.push(
          (async () => {
            const blob = dataUrlToBlob(p.file.file_data);
            await store.putBlob(entryId, key, blob);
            return {
              j,
              part: {
                ...p,
                file: { ...p.file, file_data: `${IDB_PREFIX}${key}` },
              } as ChatMessageContentPart,
            };
          })(),
        );
      }
    }

    const results = await Promise.all(promises);
    for (const { j, part } of results) {
      (out[i].content as ChatMessageContentPart[])[j] = part;
    }
  }

  return out;
}

export type PatchField = "url" | "data" | "file_data";
export interface BlobPatch {
  msgIdx: number;
  partIdx: number;
  field: PatchField;
  value: string;
}

/**
 * Reverse `persistMessageAttachments`: for every content-part field beginning
 * with `idb://`, fetch the Blob from IDB and convert back to a data URL (or
 * raw base64 for `input_audio.data`).
 *
 * Returns an array of patches to apply to the caller's message list.
 * The caller is responsible for applying the patches (different callers store
 * messages in different zustand slices).
 *
 * @param entryId   History entry ID — used as the IDB blob namespace.
 * @param messages  Messages that may contain `idb://` sentinels.
 * @param store     Blob storage interface.
 * @param keyPrefix Must match the prefix used during `persistMessageAttachments`.
 */
export async function rehydrateMessageBlobs(
  entryId: string,
  messages: ChatMessage[],
  store: BlobStore,
  keyPrefix = "",
): Promise<BlobPatch[]> {
  const patches: Array<Promise<BlobPatch | null>> = [];

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (typeof m.content === "string") continue;

    for (let j = 0; j < m.content.length; j++) {
      const p = m.content[j];
      const key = `${keyPrefix}msg${i}.part${j}`;

      if (p.type === "image_url" && p.image_url.url === `${IDB_PREFIX}${key}`) {
        patches.push(
          (async () => {
            const blob = await store.getBlob(entryId, key);
            if (!blob) return null;
            const dataUrl = await blobToDataUrl(blob);
            return { msgIdx: i, partIdx: j, field: "url" as const, value: dataUrl };
          })(),
        );
      } else if (p.type === "input_audio" && p.input_audio.data === `${IDB_PREFIX}${key}`) {
        patches.push(
          (async () => {
            const blob = await store.getBlob(entryId, key);
            if (!blob) return null;
            const dataUrl = await blobToDataUrl(blob);
            const b64 = dataUrl.split(",", 2)[1] ?? "";
            return { msgIdx: i, partIdx: j, field: "data" as const, value: b64 };
          })(),
        );
      } else if (p.type === "input_file" && p.file.file_data === `${IDB_PREFIX}${key}`) {
        patches.push(
          (async () => {
            const blob = await store.getBlob(entryId, key);
            if (!blob) return null;
            const dataUrl = await blobToDataUrl(blob);
            return { msgIdx: i, partIdx: j, field: "file_data" as const, value: dataUrl };
          })(),
        );
      }
    }
  }

  const resolved = await Promise.all(patches);
  return resolved.filter((p): p is BlobPatch => p !== null);
}

/**
 * Apply a list of `BlobPatch` objects to a deep clone of `messages`.
 * Returns the patched clone.
 */
export function applyBlobPatches(messages: ChatMessage[], patches: BlobPatch[]): ChatMessage[] {
  if (patches.length === 0) return messages;
  const msgs = structuredClone(messages) as ChatMessage[];
  for (const { msgIdx, partIdx, field, value } of patches) {
    const m = msgs[msgIdx];
    if (!m || typeof m.content === "string") continue;
    const part = m.content[partIdx];
    if (!part) continue;
    if (field === "url" && part.type === "image_url") {
      part.image_url = { ...part.image_url, url: value };
    } else if (field === "data" && part.type === "input_audio") {
      part.input_audio = { ...part.input_audio, data: value };
    } else if (field === "file_data" && part.type === "input_file") {
      part.file = { ...part.file, file_data: value };
    }
  }
  return msgs;
}
