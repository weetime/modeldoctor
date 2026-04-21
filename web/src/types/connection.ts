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

/** The subset of Connection fields a feature page edits inline. */
export type EndpointValues = Pick<
	Connection,
	"apiUrl" | "apiKey" | "model" | "customHeaders" | "queryParams"
>;

export const emptyEndpointValues: EndpointValues = {
	apiUrl: "",
	apiKey: "",
	model: "",
	customHeaders: "",
	queryParams: "",
};

export interface ConnectionsExport {
	version: 1;
	connections: Connection[];
}
