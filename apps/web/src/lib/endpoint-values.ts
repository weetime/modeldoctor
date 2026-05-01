/**
 * UI-only shape used by feature pages that show inline endpoint fields
 * (load-test / e2e-smoke). The credentials never leave the browser:
 * after a connection is picked, these values are populated for display
 * and the request still travels by `connectionId`.
 *
 * Pre-Phase 5 this lived under `@/types/connection`, alongside the
 * client-side Connection type. Once the zustand store moved to the
 * server we kept this type as a tiny local helper.
 */
export interface EndpointValues {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  customHeaders: string;
  queryParams: string;
}

export const emptyEndpointValues: EndpointValues = {
  apiBaseUrl: "",
  apiKey: "",
  model: "",
  customHeaders: "",
  queryParams: "",
};
