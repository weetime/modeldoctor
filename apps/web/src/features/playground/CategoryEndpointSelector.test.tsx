import "@/lib/i18n";
import { useConnectionsStore } from "@/stores/connections-store";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CategoryEndpointSelector } from "./CategoryEndpointSelector";

function seed() {
  const s = useConnectionsStore.getState();
  s.create({
    name: "chat-A",
    apiBaseUrl: "http://a",
    apiKey: "k",
    model: "m",
    customHeaders: "",
    queryParams: "",
    category: "chat",
    tags: [],
  });
  s.create({
    name: "embed-B",
    apiBaseUrl: "http://b",
    apiKey: "k",
    model: "m",
    customHeaders: "",
    queryParams: "",
    category: "embeddings",
    tags: [],
  });
}

describe("CategoryEndpointSelector", () => {
  beforeEach(() => {
    localStorage.clear();
    useConnectionsStore.setState({ connections: [] });
  });

  it("only lists connections of the matching category by default", async () => {
    const user = userEvent.setup();
    seed();
    render(
      <CategoryEndpointSelector category="chat" selectedConnectionId={null} onSelect={vi.fn()} />,
    );
    await user.click(screen.getByRole("combobox"));
    expect(screen.getByRole("option", { name: /chat-A/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /embed-B/i })).not.toBeInTheDocument();
  });

  it("show-all toggle reveals all connections", async () => {
    const user = userEvent.setup();
    seed();
    render(
      <CategoryEndpointSelector category="chat" selectedConnectionId={null} onSelect={vi.fn()} />,
    );
    await user.click(screen.getByRole("checkbox", { name: /show all|显示全部/i }));
    await user.click(screen.getByRole("combobox"));
    expect(screen.getByRole("option", { name: /chat-A/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /embed-B/i })).toBeInTheDocument();
  });

  it("warns when selected connection's category mismatches", () => {
    seed();
    const embedId =
      useConnectionsStore
        .getState()
        .list()
        .find((c) => c.name === "embed-B")?.id ?? null;
    render(
      <CategoryEndpointSelector
        category="chat"
        selectedConnectionId={embedId}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText(/doesn't match|不符/i)).toBeInTheDocument();
  });

  it("emits onSelect with the picked connection id", async () => {
    const user = userEvent.setup();
    seed();
    const onSelect = vi.fn();
    render(
      <CategoryEndpointSelector category="chat" selectedConnectionId={null} onSelect={onSelect} />,
    );
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: /chat-A/i }));
    const expectedId = useConnectionsStore
      .getState()
      .list()
      .find((c) => c.name === "chat-A")?.id;
    expect(onSelect).toHaveBeenCalledWith(expectedId);
  });
});
