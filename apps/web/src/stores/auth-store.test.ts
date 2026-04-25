import { beforeEach, describe, expect, it } from "vitest";
import { useAuthStore } from "./auth-store";

const mockUser = {
  id: "user-1",
  email: "test@example.com",
  roles: ["user"],
  createdAt: new Date().toISOString(),
};

describe("useAuthStore", () => {
  beforeEach(() => {
    useAuthStore.setState({ accessToken: null, user: null });
  });

  it("starts with null accessToken and user", () => {
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("setAuth stores the access token and user", () => {
    useAuthStore.getState().setAuth("token-abc", mockUser);
    expect(useAuthStore.getState().accessToken).toBe("token-abc");
    expect(useAuthStore.getState().user).toEqual(mockUser);
  });

  it("clear resets accessToken and user to null", () => {
    useAuthStore.getState().setAuth("token-abc", mockUser);
    useAuthStore.getState().clear();
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("does not use localStorage (no persist middleware)", () => {
    useAuthStore.getState().setAuth("secret-token", mockUser);
    // Ensure nothing is written to localStorage under any zustand key
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) ?? "";
      const val = localStorage.getItem(key) ?? "";
      expect(val).not.toContain("secret-token");
    }
  });
});
