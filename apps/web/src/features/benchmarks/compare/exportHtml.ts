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

export function buildExportHtml(root: HTMLElement, title: string, css: string): string {
  const clone = root.cloneNode(true) as HTMLElement;
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
