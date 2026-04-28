import { useAuthStore } from "@/stores/auth-store";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RegisterPage } from "./RegisterPage";

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
  id: "u2",
  email: "new@example.com",
  roles: ["user"],
  createdAt: new Date().toISOString(),
};

function renderRegisterPage() {
  return render(
    <MemoryRouter initialEntries={["/register"]}>
      <RegisterPage />
    </MemoryRouter>,
  );
}

describe("RegisterPage", () => {
  beforeEach(() => {
    useAuthStore.setState({ accessToken: null, user: null, accessTokenExpiresAt: null });
    vi.mocked(api.post).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it("renders email and password inputs", () => {
    renderRegisterPage();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it("shows a zod validation error for an invalid email", async () => {
    renderRegisterPage();
    const user = userEvent.setup();
    // Use fireEvent.submit to bypass jsdom's native HTML5 email constraint validation
    await user.type(screen.getByLabelText(/email/i), "bad-email");
    await user.type(screen.getByLabelText(/password/i), "password123");
    const emailForm = screen.getByRole("button", { name: /create account/i }).closest("form");
    if (emailForm) fireEvent.submit(emailForm);

    await waitFor(() => {
      expect(screen.getByText(/invalid email/i, { exact: false })).toBeInTheDocument();
    });
  });

  it("shows a zod validation error when password is too short", async () => {
    renderRegisterPage();
    const user = userEvent.setup();
    // Use fireEvent.submit to bypass jsdom native validation
    await user.type(screen.getByLabelText(/email/i), "new@example.com");
    await user.type(screen.getByLabelText(/password/i), "short");
    const pwForm = screen.getByRole("button", { name: /create account/i }).closest("form");
    if (pwForm) fireEvent.submit(pwForm);

    await waitFor(() => {
      // Zod min(8) produces "String must contain at least 8 character(s)"
      expect(screen.getByText(/at least 8/i, { exact: false })).toBeInTheDocument();
    });
  });

  it("posts to /api/auth/register and updates the store on success", async () => {
    vi.mocked(api.post).mockResolvedValue({
      accessToken: "tok-register",
      accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
      user: mockUser,
    });

    renderRegisterPage();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), "new@example.com");
    await user.type(screen.getByLabelText(/password/i), "password123");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/api/auth/register",
        expect.objectContaining({ email: "new@example.com", password: "password123" }),
      );
    });

    await waitFor(() => {
      expect(useAuthStore.getState().accessToken).toBe("tok-register");
      expect(useAuthStore.getState().user?.email).toBe("new@example.com");
    });
  });

  it("shows a server error message on failure", async () => {
    const { ApiError } = await import("@/lib/api-client");
    vi.mocked(api.post).mockRejectedValue(new ApiError(409, "Email already registered"));

    renderRegisterPage();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), "new@example.com");
    await user.type(screen.getByLabelText(/password/i), "password123");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText("Email already registered")).toBeInTheDocument();
    });
    // Inline error only — no toast (avoid double-notification)
    expect(toast.error).not.toHaveBeenCalled();
  });
});
