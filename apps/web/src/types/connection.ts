import type { ModalityCategory } from "@modeldoctor/contracts";

export interface Connection {
  id: string;
  name: string;
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  customHeaders: string;
  queryParams: string;
  category: ModalityCategory;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

/** The subset of Connection fields a feature page edits inline. */
export type EndpointValues = Pick<
  Connection,
  "apiBaseUrl" | "apiKey" | "model" | "customHeaders" | "queryParams"
>;

export const emptyEndpointValues: EndpointValues = {
  apiBaseUrl: "",
  apiKey: "",
  model: "",
  customHeaders: "",
  queryParams: "",
};

export interface ConnectionsExport {
  version: 2;
  connections: Connection[];
}
