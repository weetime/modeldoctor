function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function collectStylesheets(): string {
  const parts: string[] = [];
  for (let i = 0; i < document.styleSheets.length; i++) {
    const sheet = document.styleSheets[i];
    try {
      // Throws on cross-origin sheets; we only care about same-origin Tailwind.
      const rules = sheet.cssRules;
      for (let j = 0; j < rules.length; j++) {
        parts.push(rules[j].cssText);
      }
    } catch {
      // skip cross-origin
    }
  }
  return parts.join("\n");
}

/**
 * Replace every `<canvas>` in `clone` with a static `<img>` rasterized from the
 * matching live canvas in `live` (same document order). ECharts draws charts to
 * a canvas, and a canvas's pixels are NOT part of the DOM — `cloneNode` /
 * `outerHTML` produce a blank canvas, so a plain serialization loses every
 * chart. Snapshotting each canvas to an inline PNG data URL keeps the exported
 * file self-contained (no external JS / CDN, works offline).
 */
function inlineCanvasSnapshots(live: HTMLElement, clone: HTMLElement): void {
  const liveCanvases = live.querySelectorAll("canvas");
  const cloneCanvases = clone.querySelectorAll("canvas");
  for (let i = 0; i < cloneCanvases.length; i++) {
    const cloneCanvas = cloneCanvases[i];
    const liveCanvas = liveCanvases[i];
    if (!liveCanvas) continue;
    let dataUrl: string;
    try {
      dataUrl = liveCanvas.toDataURL("image/png");
    } catch {
      // Tainted canvas or unsupported env — leave the (blank) canvas rather
      // than aborting the whole export.
      continue;
    }
    if (!dataUrl || dataUrl === "data:,") continue;
    const img = document.createElement("img");
    img.src = dataUrl;
    img.className = cloneCanvas.className;
    // ECharts positions its canvas with inline styles (position/left/top);
    // carry them over so the image sits where the canvas did.
    img.style.cssText = cloneCanvas.style.cssText;
    // Display at the on-screen size; cap to the container so it still fits a
    // narrower page (mirrors the print canvas rule). The rect is 0 when the
    // element is hidden at export time — fall back to the backing-store width
    // divided by DPR (canvas.width is in device pixels, ~2x on Retina).
    const displayWidth =
      liveCanvas.getBoundingClientRect().width || liveCanvas.width / (window.devicePixelRatio || 1);
    img.style.width = `${displayWidth}px`;
    img.style.maxWidth = "100%";
    img.style.height = "auto";
    cloneCanvas.replaceWith(img);
  }
}

export function buildExportHtml(root: HTMLElement, title: string, css: string): string {
  const clone = root.cloneNode(true) as HTMLElement;
  // Charts are <canvas>; snapshot them to inline images before serializing.
  inlineCanvasSnapshots(root, clone);
  // Strip interactive controls — static document, no React.
  clone.querySelectorAll("button").forEach((btn) => {
    const span = document.createElement("span");
    span.innerHTML = btn.innerHTML;
    span.className = btn.className;
    btn.replaceWith(span);
  });
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${css}</style>
</head>
<body class="bg-background text-foreground">${clone.outerHTML}</body>
</html>`;
}

export async function exportPageAsHtml(root: HTMLElement, name: string): Promise<void> {
  const css = collectStylesheets();
  const html = buildExportHtml(root, name, css);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/[^a-zA-Z0-9-_]+/g, "_")}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
