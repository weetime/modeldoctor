import "@/lib/i18n";
import { ApiError } from "@/lib/api-client";
import type { PrometheusDatasourcePublic } from "@modeldoctor/contracts";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted so the sonner mock factory can refer to these symbols at hoist-time.
const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

const createMutate = vi.fn(async (body: unknown) => ({ id: "new", ...(body as object) }));
const updateMutate = vi.fn(async (vars: { id: string; body: unknown }) => ({
  id: vars.id,
  ...(vars.body as object),
}));
// Explicit return-type annotation widens the inferred type so per-test
// mockResolvedValueOnce can return the failure variant `{ ok: false, reason }`
// without TS narrowing to the happy-path shape.
type VerifyResult = { ok: boolean; version?: string; reason?: string };
const verifyMutate = vi.fn(
  async (_body: unknown): Promise<VerifyResult> => ({ ok: true, version: "2.50.0" }),
);

vi.mock("./queries", () => ({
  useCreateDatasource: () => ({ mutateAsync: createMutate, isPending: false }),
  useUpdateDatasource: () => ({ mutateAsync: updateMutate, isPending: false }),
  useVerifyDatasource: () => ({ mutateAsync: verifyMutate, isPending: false }),
}));

vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

import { DatasourceSheet } from "./DatasourceSheet";

const EXISTING: PrometheusDatasourcePublic = {
  id: "ds1",
  name: "prom-prod",
  baseUrl: "https://prom.example.com",
  bearerPreview: "ey...xyz",
  customHeaders: "",
  isDefault: true,
  consumersCount: 2,
  createdAt: "2026-05-01T00:00:00Z",
  updatedAt: "2026-05-01T00:00:00Z",
};

describe("DatasourceSheet (create)", () => {
  beforeEach(() => {
    createMutate.mockClear();
    updateMutate.mockClear();
    verifyMutate.mockClear();
    toastSuccess.mockClear();
    toastError.mockClear();
    // Reset implementations for ALL three mutations so a prior test's
    // mockRejectedValueOnce / mockResolvedValueOnce can't bleed across
    // describe blocks (matters in watch mode where files can re-run in any
    // order). Symmetric reset is cheaper than reasoning about which mock
    // each block touches.
    createMutate.mockImplementation(async (body: unknown) => ({
      id: "new",
      ...(body as object),
    }));
    updateMutate.mockImplementation(async (vars: { id: string; body: unknown }) => ({
      id: vars.id,
      ...(vars.body as object),
    }));
    verifyMutate.mockImplementation(async () => ({ ok: true, version: "2.50.0" }));
  });

  it("submits create with name, baseUrl, and optional bearer", async () => {
    const user = userEvent.setup();
    render(<DatasourceSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />);

    await user.type(screen.getByLabelText(/^name|^名称/i), "prom-prod");
    await user.type(screen.getByLabelText(/prometheus url/i), "https://prom.example.com");
    await user.type(screen.getByLabelText(/bearer token/i), "tok-abc");

    await user.click(screen.getByRole("button", { name: /^save$|^保存$/i }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    const arg = createMutate.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.name).toBe("prom-prod");
    expect(arg.baseUrl).toBe("https://prom.example.com");
    expect(arg.bearerToken).toBe("tok-abc");
    expect(arg.isDefault).toBe(false);
  });

  it("verify button POSTs to /verify with baseUrl + bearer + headers", async () => {
    const user = userEvent.setup();
    render(<DatasourceSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />);

    await user.type(screen.getByLabelText(/prometheus url/i), "https://prom.example.com");
    await user.type(screen.getByLabelText(/bearer token/i), "tok-abc");

    await user.click(screen.getByRole("button", { name: /test connection|测试连接/i }));

    await waitFor(() => expect(verifyMutate).toHaveBeenCalledTimes(1));
    expect(verifyMutate).toHaveBeenCalledWith({
      baseUrl: "https://prom.example.com",
      bearerToken: "tok-abc",
      customHeaders: undefined,
    });
  });

  it("verify button is disabled when baseUrl is empty", () => {
    render(<DatasourceSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />);
    const btn = screen.getByRole("button", { name: /test connection|测试连接/i });
    expect(btn).toBeDisabled();
  });

  it("PROMETHEUS_DATASOURCE_NAME_TAKEN → localized toast.error, no inline submitError", async () => {
    // The sheet's onSubmit catch routes the known conflict codes through
    // toastDatasourceError (per-code i18n) instead of dumping the raw
    // message into the inline error region. Lock that wiring.
    createMutate.mockRejectedValueOnce(
      new ApiError(409, "duplicate name", "PROMETHEUS_DATASOURCE_NAME_TAKEN"),
    );
    const user = userEvent.setup();
    render(<DatasourceSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />);
    await user.type(screen.getByLabelText(/^name|^名称/i), "prom-prod");
    await user.type(screen.getByLabelText(/prometheus url/i), "https://prom.example.com");
    await user.click(screen.getByRole("button", { name: /^save$|^保存$/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    // Localized "name taken" message lands in the toast; we lock the
    // distinctive substring rather than the full prose so future copy
    // tweaks don't break the test.
    expect(toastError.mock.calls[0][0]).toMatch(/已被占用|already.*taken/i);
    // Inline submitError text must NOT also render — codes are toast-routed.
    expect(screen.queryByText("duplicate name")).toBeNull();
  });

  it("PROMETHEUS_DATASOURCE_BASEURL_TAKEN → localized toast.error for the baseUrl path", async () => {
    createMutate.mockRejectedValueOnce(
      new ApiError(409, "duplicate baseurl", "PROMETHEUS_DATASOURCE_BASEURL_TAKEN"),
    );
    const user = userEvent.setup();
    render(<DatasourceSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />);
    await user.type(screen.getByLabelText(/^name|^名称/i), "prom-prod");
    await user.type(screen.getByLabelText(/prometheus url/i), "https://prom.example.com");
    await user.click(screen.getByRole("button", { name: /^save$|^保存$/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0][0]).toMatch(/url 已被登记|already.*registered|already.*taken/i);
    expect(screen.queryByText("duplicate baseurl")).toBeNull();
  });

  it("verify resolving { ok: false, reason } surfaces toast.error with the reason", async () => {
    verifyMutate.mockResolvedValueOnce({ ok: false, reason: "HTTP 401" });
    const user = userEvent.setup();
    render(<DatasourceSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />);
    await user.type(screen.getByLabelText(/prometheus url/i), "https://prom.example.com");
    await user.click(screen.getByRole("button", { name: /test connection|测试连接/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    // toast.verify.fail template includes {{reason}}; we lock that the
    // reason string the server returned makes it through to the user.
    expect(toastError.mock.calls[0][0]).toMatch(/HTTP 401/);
  });

  it("verify throwing (network/timeout) surfaces toast.error with the thrown message", async () => {
    verifyMutate.mockRejectedValueOnce(new Error("Network down"));
    const user = userEvent.setup();
    render(<DatasourceSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />);
    await user.type(screen.getByLabelText(/prometheus url/i), "https://prom.example.com");
    await user.click(screen.getByRole("button", { name: /test connection|测试连接/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0][0]).toMatch(/Network down/);
  });

  it("create mode pre-fills baseUrl + name from `initial`", () => {
    render(
      <DatasourceSheet
        open
        onOpenChange={() => {}}
        mode={{
          kind: "create",
          initial: { baseUrl: "http://discover.example:9090/", name: "discover.example:9090" },
        }}
      />,
    );
    expect(screen.getByLabelText(/prometheus url/i)).toHaveValue("http://discover.example:9090/");
    expect(screen.getByLabelText(/^name\b/i)).toHaveValue("discover.example:9090");
  });

  it("create mode without `initial` still starts with empty form (regression)", () => {
    render(<DatasourceSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />);
    expect(screen.getByLabelText(/prometheus url/i)).toHaveValue("");
    expect(screen.getByLabelText(/^name\b/i)).toHaveValue("");
  });
});

describe("DatasourceSheet (edit)", () => {
  beforeEach(() => {
    createMutate.mockClear();
    updateMutate.mockClear();
    verifyMutate.mockClear();
    toastSuccess.mockClear();
    toastError.mockClear();
    // Reset implementations for ALL three mutations so a prior test's
    // mockRejectedValueOnce / mockResolvedValueOnce can't bleed across
    // describe blocks (matters in watch mode where files can re-run in any
    // order). Symmetric reset is cheaper than reasoning about which mock
    // each block touches.
    createMutate.mockImplementation(async (body: unknown) => ({
      id: "new",
      ...(body as object),
    }));
    updateMutate.mockImplementation(async (vars: { id: string; body: unknown }) => ({
      id: vars.id,
      ...(vars.body as object),
    }));
    verifyMutate.mockImplementation(async () => ({ ok: true, version: "2.50.0" }));
  });

  it("disables bearer field by default and OMITS bearerToken from PATCH body", async () => {
    const user = userEvent.setup();
    render(
      <DatasourceSheet open onOpenChange={() => {}} mode={{ kind: "edit", existing: EXISTING }} />,
    );

    const bearerInput = screen.getByLabelText(/bearer token/i) as HTMLInputElement;
    expect(bearerInput).toBeDisabled();
    expect(bearerInput.placeholder).toBe(EXISTING.bearerPreview);

    await user.click(screen.getByRole("button", { name: /^save$|^保存$/i }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    const { id, body } = updateMutate.mock.calls[0][0] as {
      id: string;
      body: Record<string, unknown>;
    };
    expect(id).toBe("ds1");
    expect(body).not.toHaveProperty("bearerToken");
    expect(body.name).toBe("prom-prod");
    expect(body.baseUrl).toBe("https://prom.example.com");
    expect(body.isDefault).toBe(true);
  });

  it("Rotate toggle enables bearer field and INCLUDES bearerToken in PATCH body", async () => {
    const user = userEvent.setup();
    render(
      <DatasourceSheet open onOpenChange={() => {}} mode={{ kind: "edit", existing: EXISTING }} />,
    );

    const checkbox = screen.getByRole("checkbox", { name: /rotate|轮换/i });
    await user.click(checkbox);

    const bearerInput = screen.getByLabelText(/bearer token/i) as HTMLInputElement;
    expect(bearerInput).not.toBeDisabled();
    await user.type(bearerInput, "tok-NEW");

    await user.click(screen.getByRole("button", { name: /^save$|^保存$/i }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    const { body } = updateMutate.mock.calls[0][0] as { body: Record<string, unknown> };
    expect(body.bearerToken).toBe("tok-NEW");
  });
});
