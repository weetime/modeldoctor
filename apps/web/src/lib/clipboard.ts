/**
 * Copy text to the clipboard, with a fallback for non-secure (HTTP) contexts.
 *
 * `navigator.clipboard` is only defined in secure contexts (HTTPS or
 * localhost). Self-hosted ModelDoctor dashboards are frequently served over
 * plain HTTP on an internal IP, where `navigator.clipboard` is `undefined` and
 * calling `.writeText` would throw. Fall back to a hidden `<textarea>` +
 * `document.execCommand("copy")` so copy works everywhere.
 *
 * @returns true if the copy succeeded.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied / blocked — fall through to the legacy path.
    }
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
