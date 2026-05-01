import { Button } from "@/components/ui/button";
import { Eraser, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  imageUrl: string;
  width: number;
  height: number;
  brushSize: number;
  onBrushSizeChange?: (n: number) => void;
  onMaskChange: (mask: Blob | null) => void;
}

/**
 * Two stacked canvases:
 *   - base: renders the source image (read-only).
 *   - overlay: user paints a semi-transparent red brush stroke; alpha>0
 *              pixels here become alpha=0 in the exported mask, matching
 *              OpenAI's /images/edits inpaint convention.
 *
 * Single-step Undo only — `undoBuf` is captured on each pointerdown.
 */
export function MaskPainter({
  imageUrl,
  width,
  height,
  brushSize,
  onBrushSizeChange,
  onMaskChange,
}: Props) {
  const { t } = useTranslation("playground");
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const undoBuf = useRef<ImageData | null>(null);

  // Load image into base canvas. Re-runs when imageUrl/width/height change.
  useEffect(() => {
    const c = baseRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!imageUrl) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, width, height);
    };
    img.src = imageUrl;
  }, [imageUrl, width, height]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: clear overlay only when source image changes; width/height are intentionally tracked
  useEffect(() => {
    const c = overlayRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    undoBuf.current = null;
    onMaskChange(null);
  }, [imageUrl, width, height, onMaskChange]);

  function exportMask(): Promise<Blob | null> {
    const c = overlayRef.current;
    if (!c) return Promise.resolve(null);
    const ctx = c.getContext("2d");
    if (!ctx) return Promise.resolve(null);

    const out = document.createElement("canvas");
    out.width = c.width;
    out.height = c.height;
    const octx = out.getContext("2d");
    if (!octx) return Promise.resolve(null);

    // Start fully opaque black; carve out alpha=0 wherever the user painted.
    octx.fillStyle = "black";
    octx.fillRect(0, 0, out.width, out.height);

    let src: ImageData;
    try {
      src = ctx.getImageData(0, 0, c.width, c.height);
    } catch {
      // jsdom (or tainted canvas) — surface a null mask, the caller will
      // disable Submit on null.
      return Promise.resolve(null);
    }
    const dst = octx.getImageData(0, 0, out.width, out.height);
    let painted = 0;
    for (let i = 3; i < src.data.length; i += 4) {
      if (src.data[i] > 0) {
        dst.data[i] = 0;
        painted++;
      }
    }
    octx.putImageData(dst, 0, 0);
    if (painted === 0) {
      // No paint → caller should disable submit.
      return Promise.resolve(null);
    }
    return new Promise((resolve) => out.toBlob((b) => resolve(b), "image/png"));
  }

  async function emit() {
    onMaskChange(await exportMask());
  }

  function startStroke(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = overlayRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    try {
      undoBuf.current = ctx.getImageData(0, 0, c.width, c.height);
    } catch {
      undoBuf.current = null;
    }
    setDrawing(true);
    paintAt(e);
  }

  function paintAt(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = overlayRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const rect = c.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (c.width / Math.max(1, rect.width));
    const y = (e.clientY - rect.top) * (c.height / Math.max(1, rect.height));
    ctx.fillStyle = "rgba(255,0,0,0.4)";
    ctx.beginPath();
    ctx.arc(x, y, brushSize / 2, 0, 2 * Math.PI);
    ctx.fill();
  }

  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing) return;
    paintAt(e);
  }

  async function endStroke() {
    if (!drawing) return;
    setDrawing(false);
    await emit();
  }

  function onReset() {
    const c = overlayRef.current;
    if (c) {
      const ctx = c.getContext("2d");
      ctx?.clearRect(0, 0, c.width, c.height);
    }
    undoBuf.current = null;
    onMaskChange(null);
  }

  function onUndo() {
    const c = overlayRef.current;
    if (!c || !undoBuf.current) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(undoBuf.current, 0, 0);
    undoBuf.current = null;
    void emit();
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <label htmlFor="brush-size" className="text-xs text-muted-foreground">
          {t("image.inpaint.brushSize")}
        </label>
        <input
          id="brush-size"
          type="range"
          min={4}
          max={120}
          step={2}
          value={brushSize}
          onChange={(e) => onBrushSizeChange?.(Number(e.target.value))}
          aria-label={t("image.inpaint.brushSize")}
          className="flex-1"
        />
        <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">
          {brushSize}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onUndo}
          aria-label={t("image.inpaint.undo")}
        >
          <Undo2 className="mr-1 h-3 w-3" />
          {t("image.inpaint.undo")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onReset}
          aria-label={t("image.inpaint.reset")}
        >
          <Eraser className="mr-1 h-3 w-3" />
          {t("image.inpaint.reset")}
        </Button>
      </div>
      <div
        className="relative rounded-md border border-border bg-muted/30"
        style={{ width, height }}
      >
        <canvas
          ref={baseRef}
          width={width}
          height={height}
          style={{ position: "absolute", top: 0, left: 0 }}
          aria-label={t("image.inpaint.baseCanvas")}
        />
        <canvas
          ref={overlayRef}
          width={width}
          height={height}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            cursor: "crosshair",
            touchAction: "none",
          }}
          aria-label={t("image.inpaint.overlayCanvas")}
          onPointerDown={startStroke}
          onPointerMove={onMove}
          onPointerUp={endStroke}
          onPointerLeave={endStroke}
        />
      </div>
    </div>
  );
}
