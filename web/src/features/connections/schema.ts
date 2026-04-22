import { z } from "zod";

export const connectionInputSchema = z.object({
	name: z
		.string()
		.transform((v) => v.trim())
		.pipe(z.string().min(1, "required")),
	apiUrl: z.string().url("invalid URL"),
	apiKey: z.string().min(1, "required"),
	model: z.string().min(1, "required"),
	customHeaders: z.string(),
	queryParams: z.string(),
});

export type ConnectionInput = z.infer<typeof connectionInputSchema>;
