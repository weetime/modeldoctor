import type { ConnectionPublic, ConnectionWithSecret } from "@modeldoctor/contracts";
import { ClipboardPaste } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ConnectionSheet, type ConnectionSheetMode } from "@/features/connections/ConnectionSheet";
import { useConnections } from "@/features/connections/queries";
import { applyCurlToEndpoint } from "@/lib/apply-curl-to-endpoint";
import { type ParsedCurl, parseCurlCommand } from "@/lib/curl-parser";

const MANUAL = "__manual__";
const NEW_CONNECTION = "__new__";

export interface ConnectionPickerProps {
  /** Currently selected saved-connection id, or null when nothing is selected
   * (or in manual mode when `allowManual` is true). */
  selectedConnectionId: string | null;
  /** Called when the user picks a saved row (or null for Manual / fresh state). */
  onSelect: (id: string | null) => void;
  /** When true, includes a "— Manual —" entry in the dropdown so the consumer
   * can fall back to manual endpoint editing (used by endpoint diagnostics).
   * Default false: the consumer requires a saved connection (used by new
   * benchmark creation flow). */
  allowManual?: boolean;
  /**
   * Override the default curl-paste behavior. When provided, the parsed curl
   * is delivered to this callback and the picker does NOT open
   * `ConnectionSheet`. When omitted (default), paste-curl opens
   * `ConnectionSheet` with the parsed values prefilled — on save the new
   * connection's id is auto-selected via `onSelect`.
   */
  onCurlParsed?: (parsed: ParsedCurl) => void;
  /** Extra class on the outer wrapper (one row containing the select + curl button). */
  className?: string;
  /** Class for the `<SelectTrigger>` — useful for sizing inside form fields. */
  triggerClassName?: string;
  /** Hide these connection ids from the dropdown (used to avoid picking the
   * same endpoint twice in dual-endpoint flows like QG Run create). */
  excludeIds?: string[];
}

/**
 * Shared connection picker chrome — saved-connection dropdown + "New
 * connection" + "Paste cURL" button. Used by `EndpointPicker` (endpoint
 * diagnostics) and creation flows that need a saved connection (e.g.
 * new benchmark creation).
 *
 * Curl-paste behavior is configurable: pass `onCurlParsed` to handle the
 * parsed curl yourself (e.g. to fill manual endpoint fields), or omit it to
 * use the default flow (open `ConnectionSheet` prefilled with the parsed
 * values; on save auto-select the new connection).
 */
export function ConnectionPicker({
  selectedConnectionId,
  onSelect,
  allowManual = false,
  onCurlParsed,
  className,
  triggerClassName,
  excludeIds,
}: ConnectionPickerProps) {
  const { t } = useTranslation("common");
  const listQuery = useConnections();
  const fullList: ConnectionPublic[] = listQuery.data ?? [];
  const connectionList: ConnectionPublic[] = excludeIds?.length
    ? fullList.filter((c) => !excludeIds.includes(c.id))
    : fullList;

  const [curlOpen, setCurlOpen] = useState(false);
  const [curlText, setCurlText] = useState("");
  const [dialogState, setDialogState] = useState<ConnectionSheetMode | null>(null);
  const [dialogPrefill, setDialogPrefill] = useState<Record<string, unknown> | undefined>(
    undefined,
  );

  const onSelectValue = (value: string) => {
    if (value === MANUAL) {
      onSelect(null);
      return;
    }
    if (value === NEW_CONNECTION) {
      setDialogPrefill(undefined);
      setDialogState({ kind: "create" });
      return;
    }
    onSelect(value);
  };

  const onParseCurl = () => {
    const parsed = parseCurlCommand(curlText);
    if (!parsed.url && !parsed.body) {
      toast.error(t("endpoint.curlInvalid"));
      return;
    }

    if (onCurlParsed) {
      // Consumer-driven flow (endpoint diagnostics): hand back the parsed curl,
      // drop any saved selection, and reset our local curl state.
      onCurlParsed(parsed);
      onSelect(null);
      setCurlText("");
      setCurlOpen(false);
      return;
    }

    // Default flow: open ConnectionSheet prefilled so the user saves the
    // curl into a new connection. On save we auto-select it.
    const { patch, filledKeys } = applyCurlToEndpoint(parsed);
    setDialogPrefill({
      apiBaseUrl: patch.apiBaseUrl ?? "",
      apiKey: patch.apiKey ?? "",
      model: patch.model ?? "",
      customHeaders: patch.customHeaders ?? "",
      queryParams: patch.queryParams ?? "",
    });
    setDialogState({ kind: "create" });
    toast.success(t("endpoint.filled", { fields: filledKeys.join(", ") }));
    setCurlText("");
    setCurlOpen(false);
  };

  return (
    <div className={className}>
      <div className="flex flex-nowrap items-center gap-2">
        <Select
          value={selectedConnectionId ?? (allowManual ? MANUAL : "")}
          onValueChange={onSelectValue}
        >
          <SelectTrigger className={triggerClassName}>
            <SelectValue placeholder={t("endpoint.loadFromSaved")}>
              {selectedConnectionId === MANUAL || (allowManual && !selectedConnectionId)
                ? t("endpoint.manual")
                : selectedConnectionId
                  ? (connectionList.find((c) => c.id === selectedConnectionId)?.model ?? "")
                  : ""}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {allowManual ? <SelectItem value={MANUAL}>{t("endpoint.manual")}</SelectItem> : null}
            {connectionList.map((c) => (
              <SelectItem key={c.id} value={c.id} className="py-2">
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-baseline gap-2 text-sm">
                    <span className="font-medium">{c.model}</span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">{c.name}</span>
                  </div>
                  <div className="font-mono text-[11px] text-muted-foreground/70">{c.baseUrl}</div>
                </div>
              </SelectItem>
            ))}
            <SelectSeparator />
            <SelectItem value={NEW_CONNECTION}>{t("endpoint.newConnection")}</SelectItem>
          </SelectContent>
        </Select>
        {/* Inline cURL-paste button only when the consumer asked for the
         * onCurlParsed flow (endpoint diagnostics). The default path opens
         * ConnectionSheet, which has its own cURL-paste section, so a
         * second affordance here would be redundant. */}
        {onCurlParsed ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setCurlOpen((v) => !v)}
            className="shrink-0"
          >
            <ClipboardPaste className="h-3.5 w-3.5" />
            <span className="ml-1">{t("endpoint.pasteCurl")}</span>
          </Button>
        ) : null}
      </div>

      {curlOpen ? (
        <div className="mt-2 space-y-2 rounded-md border border-border bg-muted/30 p-3">
          <Textarea
            rows={5}
            value={curlText}
            onChange={(e) => setCurlText(e.target.value)}
            placeholder={t("endpoint.curlPlaceholder")}
            className="font-mono text-xs"
          />
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" onClick={onParseCurl} disabled={!curlText.trim()}>
              {t("endpoint.parseCurl")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setCurlOpen(false)}>
              {t("actions.cancel")}
            </Button>
          </div>
        </div>
      ) : null}

      <ConnectionSheet
        open={dialogState !== null}
        onOpenChange={(o) => {
          if (!o) {
            setDialogState(null);
            setDialogPrefill(undefined);
          }
        }}
        mode={dialogState ?? { kind: "create" }}
        initialValues={dialogPrefill}
        onSaved={(c: ConnectionPublic | ConnectionWithSecret) => {
          onSelect(c.id);
        }}
      />
    </div>
  );
}
