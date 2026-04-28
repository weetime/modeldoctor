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
    useAuthStore.setState({ accessToken: null, user: null, accessTokenExpiresAt: null });
    // These tests semantically assume "user has a session, probe runs".
    // BootGate now short-circuits when md_session is absent, so set it
    // explicitly here to keep the existing scenarios meaningful.
    Object.defineProperty(document, "cookie", {
      writable: true,
      configurable: true,
      value: "md_session=1",
    });
    vi.restoreAllMocks();
  });

  it("redirects unauthenticated users to /login (refresh probe returns 401)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: { get: () => null },
        json: () => Promise.resolve({}),
      }),
    );

    renderWithRoutes("/");

    await waitFor(() => {
      expect(screen.getByText("Login page")).toBeInTheDocument();
    });
  });

  it("renders protected content when user is already authenticated in store", async () => {
    // Pre-seed the store (simulates user already logged in)
    useAuthStore.setState({
      accessToken: "tok-123",
      user: mockUser,
      accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
    });

    // Refresh probe should still be called on mount; mock it as successful
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            accessToken: "tok-456",
            accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
            user: mockUser,
          }),
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
        json: () =>
          Promise.resolve({
            accessToken: "tok-from-cookie",
            accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
            user: mockUser,
          }),
      }),
    );

    renderWithRoutes("/");

    await waitFor(() => {
      expect(screen.getByText("Protected content")).toBeInTheDocument();
    });

    expect(useAuthStore.getState().accessToken).toBe("tok-from-cookie");
  });
});

describe("ProtectedRoute / BootGate session-cookie precheck", () => {
  beforeEach(() => {
    useAuthStore.setState({ accessToken: null, user: null, accessTokenExpiresAt: null });
    Object.defineProperty(document, "cookie", { writable: true, configurable: true, value: "" });
    vi.restoreAllMocks();
  });

  it("when md_session cookie is absent → redirects to /login WITHOUT calling /refresh", async () => {
    Object.defineProperty(document, "cookie", { writable: true, configurable: true, value: "" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderWithRoutes("/");

    await waitFor(() => {
      expect(screen.getByText("Login page")).toBeInTheDocument();
    });
    expect(fetchMock, "no /refresh probe when no session cookie").not.toHaveBeenCalled();
  });

  it("when md_session=1 is present → calls /refresh and renders protected", async () => {
    Object.defineProperty(document, "cookie", {
      writable: true,
      configurable: true,
      value: "md_session=1; theme=dark",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            accessToken: "ok",
            accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
            user: mockUser,
          }),
      }),
    );
    renderWithRoutes("/");
    await waitFor(() => expect(screen.getByText("Protected content")).toBeInTheDocument());
  });
});

describe("ProtectedRoute / BootGate transient retry", () => {
  beforeEach(() => {
    useAuthStore.setState({ accessToken: null, user: null, accessTokenExpiresAt: null });
    Object.defineProperty(document, "cookie", {
      writable: true,
      configurable: true,
      value: "md_session=1",
    });
    vi.restoreAllMocks();
  });

  it("retries on 429 transient then succeeds → renders protected content", async () => {
    let call = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        return {
          ok: false,
          status: 429,
          headers: { get: () => null },
          json: () => Promise.resolve({}),
        };
      }
      return {
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            accessToken: "ok-after-retry",
            accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
            user: mockUser,
          }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithRoutes("/");
    await waitFor(() => expect(screen.getByText("Protected content")).toBeInTheDocument(), {
      timeout: 5_000,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
