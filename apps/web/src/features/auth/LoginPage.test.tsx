import { useAuthStore } from "@/stores/auth-store";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "./LoginPage";

vi.mock("@/lib/api-client", () => {
  class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return {
    ApiError,
    api: { get: vi.fn(), post: vi.fn() },
  };
});

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { api } from "@/lib/api-client";
import { toast } from "sonner";

const mockUser = {
  id: "u1",
  email: "test@example.com",
  roles: ["user"],
  createdAt: new Date().toISOString(),
};

function renderLoginPage() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <LoginPage />
    </MemoryRouter>,
  );
}

describe("LoginPage", () => {
  beforeEach(() => {
    useAuthStore.setState({ accessToken: null, user: null, accessTokenExpiresAt: null });
    vi.mocked(api.post).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it("renders email and password inputs", () => {
    renderLoginPage();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it("shows a zod validation error for an invalid email", async () => {
    renderLoginPage();
    const user = userEvent.setup();
    // Use fireEvent.submit to bypass jsdom's native HTML5 email constraint validation
    // so react-hook-form's zodResolver can run and show our Zod error message.
    await user.type(screen.getByLabelText(/email/i), "not-an-email");
    await user.type(screen.getByLabelText(/password/i), "password123");
    const form = screen.getByRole("button", { name: /sign in/i }).closest("form");
    if (form) fireEvent.submit(form);

    await waitFor(() => {
      // Zod produces "Invalid email" (capital I)
      expect(screen.getByText(/invalid email/i, { exact: false })).toBeInTheDocument();
    });
  });

  it("posts to /api/auth/login and updates the store on success", async () => {
    vi.mocked(api.post).mockResolvedValue({
      accessToken: "tok-123",
      accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
      user: mockUser,
    });

    renderLoginPage();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), "test@example.com");
    await user.type(screen.getByLabelText(/password/i), "password123");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/api/auth/login",
        expect.objectContaining({ email: "test@example.com", password: "password123" }),
      );
    });

    await waitFor(() => {
      expect(useAuthStore.getState().accessToken).toBe("tok-123");
      expect(useAuthStore.getState().user?.email).toBe("test@example.com");
    });
  });

  it("shows a server error message on 401", async () => {
    const { ApiError } = await import("@/lib/api-client");
    vi.mocked(api.post).mockRejectedValue(new ApiError(401, "Invalid credentials"));

    renderLoginPage();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), "test@example.com");
    await user.type(screen.getByLabelText(/password/i), "wrongpassword");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText("Invalid credentials")).toBeInTheDocument();
    });
    // Inline error only — no toast (avoid double-notification)
    expect(toast.error).not.toHaveBeenCalled();
  });
});
