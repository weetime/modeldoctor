import type { ChatMessageContentPart } from "@modeldoctor/contracts";

export type AttachedFile =
  | { kind: "image"; dataUrl: string; mimeType: string; sizeBytes: number; name: string }
  | { kind: "audio"; dataUrl: string; mimeType: string; sizeBytes: number; name: string }
  | { kind: "file"; name: string; sizeBytes: number };

export const ATTACHMENT_LIMITS = {
  maxCount: 5,
  maxSizeBytes: 10 * 1024 * 1024,
};

export function buildContentParts(
  text: string,
  attachments: AttachedFile[],
): string | ChatMessageContentPart[] {
  if (attachments.length === 0) return text;
  const parts: ChatMessageContentPart[] = [];
  if (text.trim()) parts.push({ type: "text", text });
  for (const a of attachments) {
    if (a.kind === "image") {
      parts.push({ type: "image_url", image_url: { url: a.dataUrl } });
    } else if (a.kind === "audio") {
      const b64 = a.dataUrl.split(",", 2)[1] ?? "";
      const format = a.mimeType.split("/")[1]?.split(";")[0] ?? "wav";
      parts.push({ type: "input_audio", input_audio: { data: b64, format } });
    }
    // kind === "file" silently dropped per spec § 4.1 — placeholder only, not sent
  }
  return parts;
}

export function readFileAsAttachment(
  file: File,
  kind: AttachedFile["kind"],
): Promise<AttachedFile> {
  if (kind === "file") {
    return Promise.resolve({ kind: "file", name: file.name, sizeBytes: file.size });
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve({
        kind,
        dataUrl,
        mimeType: file.type || (kind === "image" ? "image/png" : "audio/webm"),
        sizeBytes: file.size,
        name: file.name,
      });
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(file);
  });
}
