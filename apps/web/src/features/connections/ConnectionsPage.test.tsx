import "@/lib/i18n";
import type { ConnectionPublic } from "@modeldoctor/contracts";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const seedList: ConnectionPublic[] = [
  {
    id: "c1",
    userId: "u1",
    name: "chat-prod",
    baseUrl: "http://a",
    apiKeyPreview: "sk-...1234",
    model: "qwen",
    customHeaders: "",
    queryParams: "",
    category: "chat",
    tags: ["vLLM", "production"],
    createdAt: "2026-04-26T14:22:00Z",
    updatedAt: "2026-04-26T14:22:00Z",
    prometheusUrl: null,
    serverKind: null,
    tokenizerHfId: null,
  },
  {
    id: "c2",
    userId: "u1",
    name: "embed-test",
    baseUrl: "http://b",
    apiKeyPreview: "sk-...5678",
    model: "bge",
    customHeaders: "",
    queryParams: "",
    category: "embeddings",
    tags: ["TEI"],
    createdAt: "2026-04-26T14:22:00Z",
    updatedAt: "2026-04-26T14:22:00Z",
    prometheusUrl: null,
    serverKind: null,
    tokenizerHfId: null,
  },
];

const deleteMutate = vi.fn();

vi.mock("./queries", () => ({
  useConnections: () => ({ data: seedList, isLoading: false, error: null }),
  useDeleteConnection: () => ({ mutate: deleteMutate, isPending: false }),
  // ConnectionDialog imports useCreateConnection/useUpdateConnection;
  // include stubs so the dialog renders if it ever opens.
  useCreateConnection: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateConnection: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { ConnectionsPage } from "./ConnectionsPage";

describe("ConnectionsPage (category + tags)", () => {
  beforeEach(() => {
    deleteMutate.mockClear();
  });

  it("renders category badge and tag chips for each row", () => {
    render(
      <MemoryRouter>
        <ConnectionsPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("chat-prod")).toBeInTheDocument();
    expect(screen.getByText("embed-test")).toBeInTheDocument();
    expect(screen.getByText("vLLM")).toBeInTheDocument();
    expect(screen.getByText("TEI")).toBeInTheDocument();
  });

  it("shows apiKeyPreview only", () => {
    render(
      <MemoryRouter>
        <ConnectionsPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("sk-...1234")).toBeInTheDocument();
    expect(screen.getByText("sk-...5678")).toBeInTheDocument();
  });

  it("filtering by category hides non-matching rows", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ConnectionsPage />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("combobox", { name: /category|分类/i }));
    await user.click(screen.getByRole("option", { name: /^chat$|^对话$/i }));

    expect(screen.getByText("chat-prod")).toBeInTheDocument();
    expect(screen.queryByText("embed-test")).not.toBeInTheDocument();
  });
});
