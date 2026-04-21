export interface Connection {
  id: string;
  name: string;
  apiUrl: string;
  apiKey: string;
  model: string;
  customHeaders: string;
  queryParams: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionsExport {
  version: 1;
  connections: Connection[];
}
