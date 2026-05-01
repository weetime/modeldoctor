import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { playgroundFetchMultipart } from "@/lib/playground-multipart";
import type { PlaygroundImagesResponse } from "@modeldoctor/contracts";
import { Download, ImageUp, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PromptComposer } from "../_shared/PromptComposer";
import { MaskPainter } from "./MaskPainter";
import { useImageStore } from "./store";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);
// Keep the painter at a fixed working size — uploaded images are letterboxed
// into this on the base canvas, and the exported mask matches the same
// dimensions, which is the correct/required shape for OpenAI's inpaint API.
const CANVAS_W = 512;
const CANVAS_H = 512;

export function InpaintMode() {
  const { t } = useTranslation("playground");
  const inpaint = useImageStore((s) => s.inpaint);
  const selectedConnectionId = useImageStore((s) => s.selectedConnectionId);
  const imageBlobRef = useRef<Blob | null>(null);
  const maskBlobRef = useRef<Blob | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [hasMask, setHasMask] = useState(false);

  // Revoke any previous object URL when the image changes / on unmount.
  useEffect(() => {
    return () => {
      if (imageUrl && typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [imageUrl]);

  const onPickFile = (file: File | undefined) => {
    if (!file) return;
    if (!ALLOWED_MIMES.has(file.type)) {
      toast.error(t("image.inpaint.errors.imageTypeUnsupported"));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error(t("image.inpaint.errors.imageTooLarge"));
      return;
    }
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageBlobRef.current = file;
    maskBlobRef.current = null;
    setHasMask(false);
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    useImageStore.getState().patchInpaint({
      imageName: file.name,
      imageMimeType: file.type,
      results: [],
      error: null,
    });
  };

  const onClearImage = () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageBlobRef.current = null;
    maskBlobRef.current = null;
    setHasMask(false);
    setImageUrl(null);
    useImageStore.getState().patchInpaint({
      imageName: null,
      imageMimeType: null,
      results: [],
      error: null,
    });
  };

  const onMaskChange = (blob: Blob | null) => {
    maskBlobRef.current = blob;
    setHasMask(blob !== null);
  };

  const canSubmit =
    !!selectedConnectionId &&
    !!imageBlobRef.current &&
    inpaint.prompt.trim().length > 0 &&
    hasMask &&
    !inpaint.loading;

  const onSubmit = async () => {
    const fresh = useImageStore.getState();
    const connectionId = fresh.selectedConnectionId;
    if (!connectionId || !imageBlobRef.current) return;
    if (!maskBlobRef.current) {
      toast.error(t("image.inpaint.errors.missingMask"));
      return;
    }
    fresh.patchInpaint({ loading: true, error: null });

    const form = new FormData();
    form.append("image", imageBlobRef.current, fresh.inpaint.imageName ?? "image.png");
    form.append("mask", maskBlobRef.current, "mask.png");
    form.append("connectionId", connectionId);
    form.append("prompt", fresh.inpaint.prompt.trim());
    form.append("n", String(fresh.params.n));
    if (fresh.params.size) form.append("size", fresh.params.size);

    try {
      const res = await playgroundFetchMultipart<PlaygroundImagesResponse>({
        path: "/api/playground/images/edit",
        form,
      });
      if (res.success) {
        useImageStore.getState().patchInpaint({ results: res.artifacts ?? [] });
      } else {
        const msg = res.error ?? "unknown";
        useImageStore.getState().patchInpaint({ error: msg });
        toast.error(msg);
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "network";
      useImageStore.getState().patchInpaint({ error: msg });
      toast.error(msg);
    } finally {
      useImageStore.getState().patchInpaint({ loading: false });
    }
  };

  const previews = useMemo(() => inpaint.results, [inpaint.results]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-6 py-4">
      {!imageUrl ? (
        <div className="flex h-[60vh] flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border bg-muted/30">
          <span className="text-xs text-muted-foreground">{t("image.inpaint.uploadPrompt")}</span>
          <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
            <ImageUp className="mr-2 h-4 w-4" />
            {t("image.inpaint.upload")}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              onPickFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs text-muted-foreground">{inpaint.imageName}</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClearImage}
              aria-label={t("image.inpaint.clear")}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("image.inpaint.maskHint")}</p>
          <MaskPainter
            imageUrl={imageUrl}
            width={CANVAS_W}
            height={CANVAS_H}
            brushSize={inpaint.brushSize}
            onBrushSizeChange={(n) => useImageStore.getState().patchInpaint({ brushSize: n })}
            onMaskChange={onMaskChange}
          />
        </div>
      )}

      <div>
        <label htmlFor="inpaint-prompt" className="mb-1 block text-xs text-muted-foreground">
          {t("image.inpaint.promptLabel")}
        </label>
        <PromptComposer
          inputId="inpaint-prompt"
          value={inpaint.prompt}
          onChange={(v) => useImageStore.getState().patchInpaint({ prompt: v })}
          onSubmit={onSubmit}
          sendLabel={inpaint.loading ? t("image.inpaint.sending") : t("image.inpaint.send")}
          sendDisabled={!canSubmit}
          placeholder={t("image.inpaint.promptPlaceholder")}
        />
      </div>

      {inpaint.error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {inpaint.error}
        </div>
      ) : null}

      <div className="flex min-h-[120px] items-center justify-center rounded-md border border-dashed border-border bg-muted/30 p-3">
        {previews.length === 0 ? (
          <span className="text-xs text-muted-foreground">{t("image.inpaint.previewEmpty")}</span>
        ) : (
          <div className="grid grid-flow-col gap-3">
            {previews.map((a, i) => (
              <InpaintArtifactView
                // biome-ignore lint/suspicious/noArrayIndexKey: artifacts replaced wholesale on each submit
                key={i}
                artifact={a}
                alt={inpaint.prompt}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function InpaintArtifactView({
  artifact,
  alt,
}: {
  artifact: { url?: string; b64Json?: string };
  alt: string;
}) {
  const src = artifact.url ?? (artifact.b64Json ? `data:image/png;base64,${artifact.b64Json}` : "");
  if (!src) return null;
  return (
    <div className="flex flex-col items-center gap-2">
      <img src={src} alt={alt || "Edited image"} className="max-h-[40vh] rounded-md" />
      <a
        href={src}
        download
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <Download className="h-3 w-3" /> Download
      </a>
    </div>
  );
}
