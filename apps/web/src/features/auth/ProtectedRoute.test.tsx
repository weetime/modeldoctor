import { useAuthStore } from "@/stores/auth-store";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProtectedRoute } from "./ProtectedRoute";

const mockUser = {
  id: "u1",
  email: "test@example.com",
  roles: ["user"],
  createdAt: new Date().toISOString(),
};

function renderWithRoutes(initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/login" element={<div>Login page</div>} />
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<div>Protected content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProtectedRoute", () => {
  beforeEach(() => {
    useAuthStore.setState({ accessToken: null, user: null });
    vi.restoreAllMocks();
  });

  it("redirects unauthenticated users to /login (refresh probe returns 401)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: () => Promise.resolve({}) }),
    );

    renderWithRoutes("/");

    await waitFor(() => {
      expect(screen.getByText("Login page")).toBeInTheDocument();
    });
  });

  it("renders protected content when user is already authenticated in store", async () => {
    // Pre-seed the store (simulates user already logged in)
    useAuthStore.setState({ accessToken: "tok-123", user: mockUser });

    // Refresh probe should still be called on mount; mock it as successful
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ accessToken: "tok-456", user: mockUser }),
      }),
    );

    renderWithRoutes("/");

    await waitFor(() => {
      expect(screen.getByText("Protected content")).toBeInTheDocument();
    });
  });

  it("hydrates store from refresh cookie and renders protected content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ accessToken: "tok-from-cookie", user: mockUser }),
      }),
    );

    renderWithRoutes("/");

    await waitFor(() => {
      expect(screen.getByText("Protected content")).toBeInTheDocument();
    });

    expect(useAuthStore.getState().accessToken).toBe("tok-from-cookie");
  });
});
