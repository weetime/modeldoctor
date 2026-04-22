import { z } from "zod";

export const chatSchema = z.object({
	prompt: z.string().min(1),
	maxTokens: z.coerce.number().int().min(1).max(32000),
	temperature: z.coerce.number().min(0).max(2),
	stream: z.boolean(),
});

export const embeddingsSchema = z.object({
	embeddingInput: z.string().min(1),
});

export const rerankSchema = z.object({
	rerankQuery: z.string().min(1),
	rerankTexts: z.string().min(1),
});

export const imagesSchema = z.object({
	imagePrompt: z.string().min(1),
	imageSize: z.string(),
	imageN: z.coerce.number().int().min(1).max(4),
});

export const chatVisionSchema = z.object({
	imageUrl: z.string().min(1),
	prompt: z.string().min(1),
	systemPrompt: z.string(),
	maxTokens: z.coerce.number().int().min(1).max(32000),
	temperature: z.coerce.number().min(0).max(2),
});

export const chatAudioSchema = z.object({
	prompt: z.string().min(1),
	systemPrompt: z.string(),
});

export const attackSchema = z.object({
	rate: z.coerce.number().int().min(1).max(10000),
	duration: z.coerce.number().int().min(1).max(3600),
});

export type ChatParams = z.infer<typeof chatSchema>;
export type EmbeddingsParams = z.infer<typeof embeddingsSchema>;
export type RerankParams = z.infer<typeof rerankSchema>;
export type ImagesParams = z.infer<typeof imagesSchema>;
export type ChatVisionParams = z.infer<typeof chatVisionSchema>;
export type ChatAudioParams = z.infer<typeof chatAudioSchema>;
export type AttackParams = z.infer<typeof attackSchema>;
