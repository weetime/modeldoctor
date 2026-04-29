import "@/lib/i18n";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { useConnectionsStore } from "@/stores/connections-store";
import { ConnectionsPage } from "./ConnectionsPage";

function seed() {
  const s = useConnectionsStore.getState();
  s.create({
    name: "chat-prod",
    apiBaseUrl: "http://a",
    apiKey: "k",
    model: "qwen",
    customHeaders: "",
    queryParams: "",
    category: "chat",
    tags: ["vLLM", "production"],
  });
  s.create({
    name: "embed-test",
    apiBaseUrl: "http://b",
    apiKey: "k",
    model: "bge",
    customHeaders: "",
    queryParams: "",
    category: "embeddings",
    tags: ["TEI"],
  });
}

describe("ConnectionsPage (category + tags)", () => {
  beforeEach(() => {
    localStorage.clear();
    useConnectionsStore.setState({ connections: [] });
  });

  it("renders category badge and tag chips for each row", () => {
    seed();
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

  it("filtering by category hides non-matching rows", async () => {
    const user = userEvent.setup();
    seed();
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
