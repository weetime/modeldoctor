import type { ChatMessageContentPart } from "@modeldoctor/contracts";

export type AttachedFile =
  | { kind: "image"; dataUrl: string; mimeType: string; sizeBytes: number; name: string }
  | { kind: "audio"; dataUrl: string; mimeType: string; sizeBytes: number; name: string }
  | { kind: "file"; dataUrl: string; mimeType: string; sizeBytes: number; name: string };

export const ATTACHMENT_LIMITS = {
  maxCount: 5,
  maxSizeBytes: 10 * 1024 * 1024,
};

export const ALLOWED_FILE_MIMES = new Set([
  "application/pdf",
  "text/plain",
  "application/json",
  "text/markdown",
  "text/x-markdown",
]);

export const MAX_FILE_BYTES = 8 * 1024 * 1024;

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
      const format = a.mimeType.split("/")[1]?.split(";")[0] ?? "webm";
      parts.push({ type: "input_audio", input_audio: { data: b64, format } });
    } else if (a.kind === "file") {
      parts.push({
        type: "input_file",
        file: { filename: a.name, file_data: a.dataUrl },
      });
    }
  }
  return parts;
}

export function readFileAsAttachment(
  file: File,
  kind: AttachedFile["kind"],
): Promise<AttachedFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve({
        kind,
        dataUrl,
        mimeType:
          file.type ||
          (kind === "image"
            ? "image/png"
            : kind === "audio"
              ? "audio/webm"
              : "application/octet-stream"),
        sizeBytes: file.size,
        name: file.name,
      });
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(file);
  });
}
