import { z } from "zod";

export const PublicUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  roles: z.array(z.string()),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
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
  // ISO 8601. Lets the SPA schedule a silent refresh ~30s before this
  // moment instead of waiting for a 401. Never trust this for security
  // decisions on the server; it's purely a UX hint. Source-of-truth is
  // the JWT exp claim.
  accessTokenExpiresAt: z.string().datetime(),
  user: PublicUserSchema,
});
export type AuthTokenResponse = z.infer<typeof AuthTokenResponseSchema>;

export const MeResponseSchema = PublicUserSchema;
export type MeResponse = z.infer<typeof MeResponseSchema>;

// Profile updates. Both fields optional — server only mutates what's sent.
// avatarUrl accepts either an external URL or a base64 data URL (PNG/JPEG/WebP).
// Cap data URLs at 256KB total string length to bound the row size.
export const UpdateProfileRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(60).nullable().optional(),
  avatarUrl: z
    .string()
    .max(256 * 1024)
    .nullable()
    .optional()
    .refine((v) => v == null || v === "" || v.startsWith("data:image/") || /^https?:\/\//.test(v), {
      message: "avatarUrl must be a data:image/* URL or http(s) URL",
    }),
});
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>;

export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(8).max(200),
  newPassword: z.string().min(8).max(200),
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;
