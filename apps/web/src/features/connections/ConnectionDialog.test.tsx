import "@/lib/i18n";
import type { ConnectionPublic } from "@modeldoctor/contracts";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createMutate = vi.fn(async (body: unknown) => ({ id: "new", ...(body as object) }));
const updateMutate = vi.fn(async (vars: { id: string; body: unknown }) => ({
  id: vars.id,
  ...(vars.body as object),
}));

vi.mock("./queries", () => ({
  useCreateConnection: () => ({
    mutateAsync: createMutate,
    isPending: false,
  }),
  useUpdateConnection: () => ({
    mutateAsync: updateMutate,
    isPending: false,
  }),
}));

import { ConnectionDialog } from "./ConnectionDialog";

async function fillBaseFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^name$/i), "n1");
  await user.type(screen.getByLabelText(/api base url/i), "http://x.test");
  await user.type(screen.getByLabelText(/api key/i), "sk-1");
  await user.type(screen.getByLabelText(/^model$/i), "m1");
}

const EXISTING: ConnectionPublic = {
  id: "c1",
  userId: "u1",
  name: "preexisting",
  baseUrl: "http://old.test",
  apiKeyPreview: "sk-...wxyz",
  model: "old-model",
  customHeaders: "",
  queryParams: "",
  tokenizerHfId: null,
  category: "chat",
  tags: ["vLLM"],
  createdAt: "2026-04-26T14:22:00Z",
  updatedAt: "2026-04-26T14:22:00Z",
  prometheusUrl: null,
  serverKind: null,
};

describe("ConnectionDialog (create mode)", () => {
  beforeEach(() => {
    createMutate.mockClear();
    updateMutate.mockClear();
  });

  it("requires a category before save", async () => {
    const user = userEvent.setup();
    render(<ConnectionDialog open onOpenChange={() => {}} mode={{ kind: "create" }} />);
    await fillBaseFields(user);
    await user.click(screen.getByRole("button", { name: /save|保存/i }));

    expect(screen.getAllByText(/category|分类/i).length).toBeGreaterThan(0);
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("creates a connection with selected category and entered tags", async () => {
    const user = userEvent.setup();
    render(<ConnectionDialog open onOpenChange={() => {}} mode={{ kind: "create" }} />);
    await fillBaseFields(user);

    await user.click(screen.getByRole("combobox", { name: /category|分类/i }));
    await user.click(screen.getByRole("option", { name: /^chat$|^对话$/i }));

    const tagInput = screen.getByLabelText(/^tags$/i);
    await user.type(tagInput, "vLLM{Enter}");
    await user.type(tagInput, "production{Enter}");

    await user.click(screen.getByRole("button", { name: /save|保存/i }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    const arg = createMutate.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.name).toBe("n1");
    expect(arg.baseUrl).toBe("http://x.test");
    expect(arg.apiKey).toBe("sk-1");
    expect(arg.model).toBe("m1");
    expect(arg.category).toBe("chat");
    expect(arg.tags).toEqual(["vLLM", "production"]);
  });

  it("removing a chip drops the tag", async () => {
    const user = userEvent.setup();
    render(<ConnectionDialog open onOpenChange={() => {}} mode={{ kind: "create" }} />);
    const tagInput = screen.getByLabelText(/^tags$/i);
    await user.type(tagInput, "x{Enter}");
    await user.type(tagInput, "y{Enter}");

    await user.click(screen.getByRole("button", { name: /remove tag x|移除标签 x/i }));

    expect(screen.queryByText("x")).not.toBeInTheDocument();
    expect(screen.getByText("y")).toBeInTheDocument();
  });

  it("submits tokenizerHfId when filled", async () => {
    const user = userEvent.setup();
    render(<ConnectionDialog open onOpenChange={() => {}} mode={{ kind: "create" }} />);
    await fillBaseFields(user);

    await user.click(screen.getByRole("combobox", { name: /category|分类/i }));
    await user.click(screen.getByRole("option", { name: /^chat$|^对话$/i }));

    await user.type(screen.getByLabelText(/tokenizer/i), "Qwen/Qwen2.5-0.5B-Instruct");

    await user.click(screen.getByRole("button", { name: /save|保存/i }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    const arg = createMutate.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.tokenizerHfId).toBe("Qwen/Qwen2.5-0.5B-Instruct");
  });

  it("submits null when tokenizerHfId left empty", async () => {
    const user = userEvent.setup();
    render(<ConnectionDialog open onOpenChange={() => {}} mode={{ kind: "create" }} />);
    await fillBaseFields(user);

    await user.click(screen.getByRole("combobox", { name: /category|分类/i }));
    await user.click(screen.getByRole("option", { name: /^chat$|^对话$/i }));

    // Leave tokenizer field blank (default is "")
    await user.click(screen.getByRole("button", { name: /save|保存/i }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    const arg = createMutate.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.tokenizerHfId).toBeNull();
  });
});

describe("ConnectionDialog (edit mode)", () => {
  beforeEach(() => {
    createMutate.mockClear();
    updateMutate.mockClear();
  });

  it("disables apiKey field by default and OMITS apiKey from the PATCH body", async () => {
    const user = userEvent.setup();
    render(
      <ConnectionDialog open onOpenChange={() => {}} mode={{ kind: "edit", existing: EXISTING }} />,
    );

    const apiKeyInput = screen.getByLabelText(/^api key$/i) as HTMLInputElement;
    expect(apiKeyInput).toBeDisabled();
    expect(apiKeyInput.placeholder).toBe(EXISTING.apiKeyPreview);

    await user.click(screen.getByRole("button", { name: /save|保存/i }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    const { id, body } = updateMutate.mock.calls[0][0] as {
      id: string;
      body: Record<string, unknown>;
    };
    expect(id).toBe("c1");
    expect(body).not.toHaveProperty("apiKey");
    expect(body.name).toBe("preexisting");
    expect(body.baseUrl).toBe("http://old.test");
  });

  it("Reset apiKey toggle enables the field and INCLUDES apiKey in PATCH body", async () => {
    const user = userEvent.setup();
    render(
      <ConnectionDialog open onOpenChange={() => {}} mode={{ kind: "edit", existing: EXISTING }} />,
    );

    const checkbox = screen.getByRole("checkbox", { name: /reset api key|重新设置/i });
    await user.click(checkbox);

    const apiKeyInput = screen.getByLabelText(/^api key$/i) as HTMLInputElement;
    expect(apiKeyInput).not.toBeDisabled();
    await user.type(apiKeyInput, "sk-NEW");

    await user.click(screen.getByRole("button", { name: /save|保存/i }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    const { body } = updateMutate.mock.calls[0][0] as { body: Record<string, unknown> };
    expect(body.apiKey).toBe("sk-NEW");
  });
});
