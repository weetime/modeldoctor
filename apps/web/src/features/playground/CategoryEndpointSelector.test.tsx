import "@/lib/i18n";
import type { ConnectionPublic } from "@modeldoctor/contracts";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const list: ConnectionPublic[] = [
  {
    id: "c-chat",
    userId: "u1",
    name: "chat-A",
    baseUrl: "http://a",
    apiKeyPreview: "sk-...1234",
    model: "m",
    customHeaders: "",
    queryParams: "",
    category: "chat",
    tags: [],
    createdAt: "2026-04-26T14:22:00Z",
    updatedAt: "2026-04-26T14:22:00Z",
    prometheusUrl: null,
    serverKind: null,
    tokenizerHfId: null,
  },
  {
    id: "c-embed",
    userId: "u1",
    name: "embed-B",
    baseUrl: "http://b",
    apiKeyPreview: "sk-...5678",
    model: "m",
    customHeaders: "",
    queryParams: "",
    category: "embeddings",
    tags: [],
    createdAt: "2026-04-26T14:22:00Z",
    updatedAt: "2026-04-26T14:22:00Z",
    prometheusUrl: null,
    serverKind: null,
    tokenizerHfId: null,
  },
];

vi.mock("@/features/connections/queries", () => ({
  useConnections: () => ({ data: list, isLoading: false, error: null }),
}));

import { CategoryEndpointSelector } from "./CategoryEndpointSelector";

describe("CategoryEndpointSelector", () => {
  it("only lists connections of the matching category by default", async () => {
    const user = userEvent.setup();
    render(
      <CategoryEndpointSelector category="chat" selectedConnectionId={null} onSelect={vi.fn()} />,
    );
    await user.click(screen.getByRole("combobox"));
    expect(screen.getByRole("option", { name: /chat-A/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /embed-B/i })).not.toBeInTheDocument();
  });

  it("show-all toggle reveals all connections", async () => {
    const user = userEvent.setup();
    render(
      <CategoryEndpointSelector category="chat" selectedConnectionId={null} onSelect={vi.fn()} />,
    );
    await user.click(screen.getByRole("checkbox", { name: /show all|显示全部/i }));
    await user.click(screen.getByRole("combobox"));
    expect(screen.getByRole("option", { name: /chat-A/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /embed-B/i })).toBeInTheDocument();
  });

  it("warns when selected connection's category mismatches", () => {
    render(
      <CategoryEndpointSelector
        category="chat"
        selectedConnectionId="c-embed"
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText(/doesn't match|不符/i)).toBeInTheDocument();
  });

  it("emits onSelect with the picked connection id", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <CategoryEndpointSelector category="chat" selectedConnectionId={null} onSelect={onSelect} />,
    );
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: /chat-A/i }));
    expect(onSelect).toHaveBeenCalledWith("c-chat");
  });
});
