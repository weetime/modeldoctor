import i18n from "@/lib/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import { PasswordSection } from "./PasswordSection";

vi.mock("./queries", () => ({
  useChangePassword: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <PasswordSection />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

describe("PasswordSection", () => {
  it("renders three password inputs", () => {
    renderIt();
    expect(screen.getByLabelText(/current password|当前密码/i)).toBeInTheDocument();
    // Use name attribute to distinguish "New password" input from "Confirm new password"
    expect(document.querySelector('input[name="newPassword"]')).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm new password|确认新密码/i)).toBeInTheDocument();
  });

  it("shows mismatch error when confirm differs from new", async () => {
    renderIt();
    const newPw = document.querySelector('input[name="newPassword"]') as HTMLElement;
    const confirm = screen.getByLabelText(/confirm new password|确认新密码/i);
    fireEvent.change(newPw, { target: { value: "abcdefgh" } });
    fireEvent.change(confirm, { target: { value: "different1" } });
    fireEvent.blur(confirm);
    await waitFor(() => {
      expect(screen.getByText(/do not match|不一致/)).toBeInTheDocument();
    });
  });
});
