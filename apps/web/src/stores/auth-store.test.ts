import { beforeEach, describe, expect, it } from "vitest";
import { useAuthStore } from "./auth-store";

const mockUser = {
  id: "user-1",
  email: "test@example.com",
  roles: ["user"],
  createdAt: new Date().toISOString(),
};

const futureExpiresAt = () => new Date(Date.now() + 900_000).toISOString();

describe("useAuthStore", () => {
  beforeEach(() => {
    useAuthStore.setState({ accessToken: null, user: null, accessTokenExpiresAt: null });
  });

  it("starts with null accessToken, user, and accessTokenExpiresAt", () => {
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().accessTokenExpiresAt).toBeNull();
  });

  it("setAuth stores the access token, user, and expiresAt", () => {
    const expiresAt = futureExpiresAt();
    useAuthStore.getState().setAuth("token-abc", mockUser, expiresAt);
    expect(useAuthStore.getState().accessToken).toBe("token-abc");
    expect(useAuthStore.getState().user).toEqual(mockUser);
    expect(useAuthStore.getState().accessTokenExpiresAt).toBe(expiresAt);
  });

  it("clear resets accessToken, user, and accessTokenExpiresAt to null", () => {
    useAuthStore.getState().setAuth("token-abc", mockUser, futureExpiresAt());
    useAuthStore.getState().clear();
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().accessTokenExpiresAt).toBeNull();
  });

  it("does not use localStorage (no persist middleware)", () => {
    useAuthStore.getState().setAuth("secret-token", mockUser, futureExpiresAt());
    // Ensure nothing is written to localStorage under any zustand key
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) ?? "";
      const val = localStorage.getItem(key) ?? "";
      expect(val).not.toContain("secret-token");
    }
  });
});
