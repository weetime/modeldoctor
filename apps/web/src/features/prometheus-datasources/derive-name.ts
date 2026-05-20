// Derive a sensible default Datasource `name` from a Prometheus base URL.
// Used by the Discover→register CTA so the pre-filled DatasourceSheet
// already has a reasonable name the admin can accept or edit.
export function deriveDatasourceNameFromUrl(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}
