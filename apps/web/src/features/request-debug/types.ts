import type { DebugProxyResponse } from "@modeldoctor/contracts";

export type { DebugProxyResponse } from "@modeldoctor/contracts";

// FE-only UI types stay here.
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export interface KeyValueRow {
  key: string;
  value: string;
  enabled: boolean;
}

/**
 * FE-only view of the success branch of {@link DebugProxyResponse}, without
 * the `success` discriminator. This is what the mutation produces after it
 * narrows the wire-format union.
 */
export type DebugResponse = Omit<Extract<DebugProxyResponse, { success: true }>, "success">;
