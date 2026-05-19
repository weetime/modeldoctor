import "@/lib/i18n";
import type { PrometheusDatasourcePublic } from "@modeldoctor/contracts";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createMutate = vi.fn(async (body: unknown) => ({ id: "new", ...(body as object) }));
const updateMutate = vi.fn(async (vars: { id: string; body: unknown }) => ({
  id: vars.id,
  ...(vars.body as object),
}));
const verifyMutate = vi.fn(async (_body: unknown) => ({ ok: true, version: "2.50.0" }));

vi.mock("./queries", () => ({
  useCreateDatasource: () => ({ mutateAsync: createMutate, isPending: false }),
  useUpdateDatasource: () => ({ mutateAsync: updateMutate, isPending: false }),
  useVerifyDatasource: () => ({ mutateAsync: verifyMutate, isPending: false }),
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
});

describe("DatasourceSheet (edit)", () => {
  beforeEach(() => {
    createMutate.mockClear();
    updateMutate.mockClear();
    verifyMutate.mockClear();
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
