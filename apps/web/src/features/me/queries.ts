import { api } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import type {
  ChangePasswordRequest,
  PublicUser,
  UpdateProfileRequest,
} from "@modeldoctor/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";

const AUTH_ME_KEY = ["auth", "me"] as const;

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProfileRequest) => api.patch<PublicUser>("/api/me", body),
    onSuccess: (u) => {
      qc.setQueryData(AUTH_ME_KEY, u);
      useAuthStore.getState().setUser(u);
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (body: ChangePasswordRequest) => api.post<void>("/api/me/password", body),
  });
}
