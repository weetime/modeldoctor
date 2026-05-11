import { ConnectionPicker } from "@/components/connection/ConnectionPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConnectionSheet, type ConnectionSheetMode } from "@/features/connections/ConnectionSheet";
import { useConnection } from "@/features/connections/queries";
import { applyCurlToEndpoint } from "@/lib/apply-curl-to-endpoint";
import type { ParsedCurl } from "@/lib/curl-parser";
import { type EndpointValues, emptyEndpointValues } from "@/lib/endpoint-values";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";

export interface EndpointPickerProps {
  /** Current endpoint values surfaced for display + curl import paths. */
  endpoint: EndpointValues;
  /** Currently selected connection id (server-side), or null for "manual" / fresh state. */
  selectedConnectionId: string | null;
  /** Called when the user picks a connection or chooses "Manual". */
  onSelect: (id: string | null) => void;
  /** Called when the endpoint values change (curl parse). After Phase-5 the
   * fields are read-only when a connection is selected; this still fires when
   * curl import populates the manual-mode form. */
  onEndpointChange: (values: EndpointValues) => void;
  /**
   * Optional: consumers that care about curl body fields (e.g. to populate
   * their own request slice) can subscribe.
   */
  onCurlParsed?: (parsed: ParsedCurl) => void;
  /**
   * Optional: when provided, renders a `→ POST <url>` preview line below
   * the API Base URL input (e.g. the full request URL derived from the
   * base URL + tool-specific path).
   */
  previewUrl?: string;
}

/**
 * Endpoint picker + read-only display embedded in a page card. Once a saved
 * connection is selected, all fields show in read-only form (apiKey shows
 * the preview); the user must use "Edit this connection" or "Save as new
 * connection" to change anything.
 *
 * In manual mode (no connection selected), the user can still paste a cURL
 * to inspect — but to actually use it for a request flow they must save it
 * as a new connection first (the `connectionId` is required server-side).
 *
 * The top-row picker chrome (saved-connection dropdown + Manual + "New
 * connection" + "Paste cURL") is shared with `<ConnectionPicker>` so
 * creation pages get the
 * same UX.
 */
export function EndpointPicker({
  endpoint,
  selectedConnectionId,
  onSelect,
  onEndpointChange,
  onCurlParsed,
  previewUrl,
}: EndpointPickerProps) {
  const { t } = useTranslation("common");
  const { t: tConn } = useTranslation("connections");
  const detailQuery = useConnection(selectedConnectionId);
  const selectedConn = detailQuery.data ?? null;

  const [dialogState, setDialogState] = useState<ConnectionSheetMode | null>(null);

  const apiBaseUrlId = useId();
  const apiKeyId = useId();
  const modelId = useId();
  const customHeadersId = useId();
  const queryParamsId = useId();

  const hasSelection = !!selectedConn;

  // When a saved connection is selected, hydrate the readonly endpoint
  // mirror so the page that owns endpoint state shows the right values
  // (esp. for the previewUrl base) without the user having to do anything.
  useEffect(() => {
    if (!selectedConn) return;
    const next: EndpointValues = {
      apiBaseUrl: selectedConn.baseUrl,
      apiKey: selectedConn.apiKeyPreview,
      model: selectedConn.model,
      customHeaders: selectedConn.customHeaders,
      queryParams: selectedConn.queryParams,
    };
    if (
      next.apiBaseUrl !== endpoint.apiBaseUrl ||
      next.apiKey !== endpoint.apiKey ||
      next.model !== endpoint.model ||
      next.customHeaders !== endpoint.customHeaders ||
      next.queryParams !== endpoint.queryParams
    ) {
      onEndpointChange(next);
    }
  }, [selectedConn, endpoint, onEndpointChange]);

  const handleManualSelect = (id: string | null) => {
    onSelect(id);
    if (id === null) {
      // Going back to manual mode — clear the readonly mirror.
      onEndpointChange(emptyEndpointValues);
    }
  };

  const handleCurlParsed = (parsed: ParsedCurl) => {
    const { patch } = applyCurlToEndpoint(parsed);
    // Parsing a curl moves us off any saved connection AND fills manual fields.
    onSelect(null);
    onEndpointChange({ ...emptyEndpointValues, ...endpoint, ...patch });
    onCurlParsed?.(parsed);
  };

  const onEditClick = () => {
    if (!selectedConn) return;
    setDialogState({ kind: "edit", existing: selectedConn });
  };

  const onSaveAsClick = () => {
    setDialogState({ kind: "create" });
  };

  // Compute prefill for the Edit/Save-as dialog. "Save as new" from a saved
  // row copies all fields except apiKey (we only know the preview); the user
  // re-enters the secret. Manual mode mirrors the current local form.
  const dialogInitialValues =
    dialogState?.kind === "create"
      ? selectedConn
        ? {
            name: `${selectedConn.name}-copy`,
            apiBaseUrl: selectedConn.baseUrl,
            model: selectedConn.model,
            customHeaders: selectedConn.customHeaders,
            queryParams: selectedConn.queryParams,
            category: selectedConn.category,
            tags: selectedConn.tags,
          }
        : {
            apiBaseUrl: endpoint.apiBaseUrl,
            model: endpoint.model,
            customHeaders: endpoint.customHeaders,
            queryParams: endpoint.queryParams,
          }
      : undefined;

  return (
    <div className="space-y-3">
      <ConnectionPicker
        selectedConnectionId={selectedConnectionId}
        onSelect={handleManualSelect}
        allowManual
        onCurlParsed={handleCurlParsed}
        className="flex justify-end"
        triggerClassName="h-9 min-w-[200px] text-xs"
      />

      <ConnectionSheet
        open={dialogState !== null}
        onOpenChange={(o) => {
          if (!o) setDialogState(null);
        }}
        mode={dialogState ?? { kind: "create" }}
        initialValues={dialogInitialValues}
        onSaved={(c) => {
          onSelect(c.id);
        }}
      />

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("endpoint.label")}
        </h2>
        <div className="space-y-3">
          <div>
            <Label htmlFor={apiBaseUrlId}>{t("endpoint.apiBaseUrl")}</Label>
            <Input
              id={apiBaseUrlId}
              value={endpoint.apiBaseUrl}
              readOnly={hasSelection}
              onChange={(e) =>
                hasSelection
                  ? undefined
                  : onEndpointChange({ ...endpoint, apiBaseUrl: e.target.value })
              }
              placeholder="http://host:port or https://api.openai.com"
              className="font-mono text-xs"
            />
            <p className="mt-1 text-xs text-muted-foreground">{t("endpoint.apiBaseUrlHelp")}</p>
            {previewUrl && (
              <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                → POST {previewUrl}
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <Label htmlFor={apiKeyId}>{t("endpoint.apiKey")}</Label>
              <Input
                id={apiKeyId}
                type="text"
                value={endpoint.apiKey}
                readOnly={hasSelection}
                onChange={(e) =>
                  hasSelection
                    ? undefined
                    : onEndpointChange({ ...endpoint, apiKey: e.target.value })
                }
                placeholder="sk-…"
                className="font-mono text-xs"
              />
              {hasSelection ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {tConn("dialog.apiKeyEncryptedNotice")}
                </p>
              ) : null}
            </div>
            <div>
              <Label htmlFor={modelId}>{t("endpoint.model")}</Label>
              <Input
                id={modelId}
                value={endpoint.model}
                readOnly={hasSelection}
                onChange={(e) =>
                  hasSelection
                    ? undefined
                    : onEndpointChange({ ...endpoint, model: e.target.value })
                }
                placeholder="model-name"
                className="font-mono text-xs"
              />
            </div>
          </div>
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
              {t("endpoint.advanced")}
            </summary>
            <div className="mt-2 space-y-3">
              <div>
                <Label htmlFor={customHeadersId}>{t("endpoint.customHeaders")}</Label>
                <Textarea
                  id={customHeadersId}
                  rows={2}
                  value={endpoint.customHeaders}
                  readOnly={hasSelection}
                  onChange={(e) =>
                    hasSelection
                      ? undefined
                      : onEndpointChange({ ...endpoint, customHeaders: e.target.value })
                  }
                  placeholder="Header-Name: value"
                  className="font-mono text-xs"
                />
              </div>
              <div>
                <Label htmlFor={queryParamsId}>{t("endpoint.queryParams")}</Label>
                <Textarea
                  id={queryParamsId}
                  rows={2}
                  value={endpoint.queryParams}
                  readOnly={hasSelection}
                  onChange={(e) =>
                    hasSelection
                      ? undefined
                      : onEndpointChange({ ...endpoint, queryParams: e.target.value })
                  }
                  placeholder="key=value"
                  className="font-mono text-xs"
                />
              </div>
            </div>
          </details>

          {hasSelection ? (
            <div className="flex items-center gap-2 pt-1">
              <Button type="button" size="sm" variant="outline" onClick={onEditClick}>
                {tConn("dialog.editThisConnection")} →
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={onSaveAsClick}>
                {tConn("dialog.saveAsNewConnection")} →
              </Button>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export { emptyEndpointValues };
export type { EndpointValues };
