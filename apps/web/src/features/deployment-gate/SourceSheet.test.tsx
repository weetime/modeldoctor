import "@/lib/i18n";
import type { PlatformSource } from "@modeldoctor/contracts";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted so the sonner/api mock factories can refer to these symbols at
// hoist-time (vi.mock factories run before top-level const declarations).
const { toastSuccess, toastError, testSavedSourceMock } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  testSavedSourceMock: vi.fn(async () => ({ ok: true, modelCount: 5, error: null })),
}));

const createMutate = vi.fn(async (body: unknown) => ({ id: "new", ...(body as object) }));
const updateMutate = vi.fn(async (vars: { id: string; body: unknown }) => ({
  id: vars.id,
  ...(vars.body as object),
}));
const testMutate = vi.fn(async () => ({ ok: true, modelCount: 3, error: null }));

vi.mock("./queries", () => ({
  useCreateSource: () => ({ mutateAsync: createMutate, isPending: false }),
  useUpdateSource: () => ({ mutateAsync: updateMutate, isPending: false }),
  useTestSource: () => ({ mutateAsync: testMutate, isPending: false }),
}));

vi.mock("./api", () => ({
  dgApi: { testSavedSource: testSavedSourceMock },
}));

vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

import { SourceSheet } from "./SourceSheet";

const EXISTING: PlatformSource = {
  id: "s1",
  kind: "gpustack",
  name: "prod",
  baseUrl: "http://gpustack.example.com",
  clusterId: null,
  enabled: true,
  lastSyncAt: null,
  lastSyncError: null,
  modelCount: 3,
  createdAt: "2026-05-01T00:00:00Z",
  updatedAt: "2026-05-01T00:00:00Z",
};

function resetMocks() {
  createMutate.mockClear();
  updateMutate.mockClear();
  testMutate.mockClear();
  testSavedSourceMock.mockClear();
  toastSuccess.mockClear();
  toastError.mockClear();
  createMutate.mockImplementation(async (body: unknown) => ({ id: "new", ...(body as object) }));
  updateMutate.mockImplementation(async (vars: { id: string; body: unknown }) => ({
    id: vars.id,
    ...(vars.body as object),
  }));
  testMutate.mockImplementation(async () => ({ ok: true, modelCount: 3, error: null }));
  testSavedSourceMock.mockImplementation(async () => ({ ok: true, modelCount: 5, error: null }));
}

describe("SourceSheet (create)", () => {
  beforeEach(resetMocks);

  it("submit failure surfaces toast.error and keeps the sheet open", async () => {
    createMutate.mockRejectedValueOnce(new Error("name already taken"));
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<SourceSheet open onOpenChange={onOpenChange} existing={null} />);

    await user.type(screen.getByLabelText(/^名称|^name/i), "prod");
    await user.type(screen.getByLabelText(/GPUStack.*(地址|URL)/i), "http://gpustack.example.com");
    await user.type(screen.getByLabelText(/API Key/i), "secret-key");
    await user.click(screen.getByRole("button", { name: /保存|save/i }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0][0]).toMatch(/name already taken/);
    // Sheet must stay open on failure — onOpenChange(false) is NEVER called.
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("submit success closes the sheet via onOpenChange(false)", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<SourceSheet open onOpenChange={onOpenChange} existing={null} />);

    await user.type(screen.getByLabelText(/^名称|^name/i), "prod");
    await user.type(screen.getByLabelText(/GPUStack.*(地址|URL)/i), "http://gpustack.example.com");
    await user.type(screen.getByLabelText(/API Key/i), "secret-key");
    await user.click(screen.getByRole("button", { name: /保存|save/i }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toastError).not.toHaveBeenCalled();
  });
});

describe("SourceSheet (edit)", () => {
  beforeEach(resetMocks);

  it("leaving the API key field empty omits apiKey from the PATCH body", async () => {
    const user = userEvent.setup();
    render(<SourceSheet open onOpenChange={() => {}} existing={EXISTING} />);

    await user.click(screen.getByRole("button", { name: /保存|save/i }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    const { id, body } = updateMutate.mock.calls[0][0] as {
      id: string;
      body: Record<string, unknown>;
    };
    expect(id).toBe("s1");
    expect(body).not.toHaveProperty("apiKey");
    expect(body.name).toBe("prod");
    expect(body.baseUrl).toBe("http://gpustack.example.com");
  });

  it("test connection with an empty key field uses testSavedSource(id), not an empty-string test", async () => {
    const user = userEvent.setup();
    render(<SourceSheet open onOpenChange={() => {}} existing={EXISTING} />);

    await user.click(screen.getByRole("button", { name: /测试连接|test connection/i }));

    await waitFor(() => expect(testSavedSourceMock).toHaveBeenCalledWith("s1"));
    expect(testMutate).not.toHaveBeenCalled();
  });
});
