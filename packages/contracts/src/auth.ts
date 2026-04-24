import { z } from "zod";

export const PublicUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  roles: z.array(z.string()),
  createdAt: z.string(), // ISO
});
export type PublicUser = z.infer<typeof PublicUserSchema>;

export const RegisterRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = RegisterRequestSchema;
export type LoginRequest = RegisterRequest;

export const AuthTokenResponseSchema = z.object({
  accessToken: z.string(),
  user: PublicUserSchema,
});
export type AuthTokenResponse = z.infer<typeof AuthTokenResponseSchema>;

export const MeResponseSchema = PublicUserSchema;
export type MeResponse = z.infer<typeof MeResponseSchema>;
