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
  // Static export carries no React, so re-add the two interactive behaviours as
  // plain JS: (1) TOC scroll-spy highlighting; (2) a floating button that
  // toggles full-screen (TOC-hidden) reading via `body.pr-fullscreen` — the same
  // class + CSS (bundled from primer-report.css) the live preview page uses, so
  // the interaction is identical in both surfaces. ⛶ = fullscreen glyph.
  const runtime = `<script>
(function(){
  var links=[].slice.call(document.querySelectorAll('.pr-toc a[href^="#pr-section-"]'));
  function setActive(id){links.forEach(function(a){a.classList.toggle("active",a.getAttribute("href")==="#"+id);});}
  var secs=links.map(function(a){return document.getElementById(a.getAttribute("href").slice(1));}).filter(Boolean);
  if(window.IntersectionObserver&&secs.length){
    var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting)setActive(e.target.id);});},{rootMargin:"0px 0px -70% 0px"});
    secs.forEach(function(s){io.observe(s);});
  }
  var b=document.createElement("button");
  b.textContent="⛶";
  b.title="Toggle contents / full-width";
  b.setAttribute("style","position:fixed;top:16px;right:16px;z-index:1000;width:36px;height:36px;border-radius:8px;border:1px solid #d0d7de;background:#fff;cursor:pointer;font-size:16px;line-height:1;box-shadow:0 1px 3px rgba(0,0,0,.12)");
  b.onclick=function(){document.body.classList.toggle("pr-fullscreen");};
  document.body.appendChild(b);
})();
</script>`;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${css}</style>
</head>
<body class="bg-background text-foreground">${clone.outerHTML}${runtime}</body>
</html>`;
}

export async function exportPageAsHtml(root: HTMLElement, name: string): Promise<void> {
  const css = collectStylesheets();
  const html = buildExportHtml(root, name, css);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  // Preserve the report title (incl. CJK) in the filename; only collapse
  // filesystem-unsafe chars + whitespace to "_", trim, and fall back if empty.
  const safe = name.replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "") || "report";
  a.download = `${safe}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
