export type ProbeName = "text" | "image" | "audio";

export interface ProbeCheck {
	name: string;
	pass: boolean;
	info?: string;
}

export interface ProbeResult {
	pass: boolean;
	latencyMs: number | null;
	checks: ProbeCheck[];
	details: {
		content?: string;
		usage?: { prompt_tokens: number; completion_tokens: number };
		imagePreviewB64?: string;
		imageMime?: string;
		audioB64?: string;
		audioBytes?: number;
		numChoices?: number;
		textReply?: string;
		error?: string;
	};
}
