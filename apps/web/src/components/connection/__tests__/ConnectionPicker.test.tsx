import type { ConnectionPublic } from "@modeldoctor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "@/lib/i18n";

vi.mock("@/features/connections/queries", () => ({
  useConnections: vi.fn(() => ({ data: [], isLoading: false })),
  useConnection: vi.fn(() => ({ data: null })),
  useCreateConnection: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useUpdateConnection: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
}));

vi.mock("@/features/connections/ConnectionDialog", () => ({
  ConnectionDialog: () => null,
}));

import { useConnections } from "@/features/connections/queries";
import { ConnectionPicker } from "../ConnectionPicker";

const conn: ConnectionPublic = {
  id: "c_1",
  userId: "u_1",
  name: "bge-by-mis-tei",
  baseUrl: "http://183.240.109.2:30888",
  apiKeyPreview: "sk-...bc8d",
  model: "gen-studio_bge-m3-uZbs",
  customHeaders: "",
  queryParams: "",
  category: "embeddings",
  tags: [],
  prometheusUrl: null,
  serverKind: null,
  tokenizerHfId: null,
  createdAt: "2026-05-06T00:00:00.000Z",
  updatedAt: "2026-05-06T00:00:00.000Z",
};

function withQc(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

describe("ConnectionPicker", () => {
  it("dropdown option shows name + model + baseUrl on two visual lines", async () => {
    (useConnections as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [conn],
      isLoading: false,
    });
    render(withQc(<ConnectionPicker selectedConnectionId={null} onSelect={() => {}} />));
    // Open dropdown.
    await userEvent.click(screen.getByRole("combobox"));
    // Both name and model and baseUrl are present in the option.
    expect(await screen.findByText("bge-by-mis-tei")).toBeInTheDocument();
    expect(screen.getByText("gen-studio_bge-m3-uZbs")).toBeInTheDocument();
    expect(screen.getByText("http://183.240.109.2:30888")).toBeInTheDocument();
  });

  it("disables connections per disabledReason and sorts disabled ones to the bottom", async () => {
    const c2: ConnectionPublic = { ...conn, id: "c_2", name: "audio-conn", category: "audio" };
    const c3: ConnectionPublic = { ...conn, id: "c_3", name: "chat-conn", category: "chat" };
    (useConnections as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [conn, c2, c3], // server order: embeddings, audio, chat
      isLoading: false,
    });
    render(
      withQc(
        <ConnectionPicker
          selectedConnectionId={null}
          onSelect={() => {}}
          disabledReason={(c) => (c.category === "embeddings" ? "no embeddings here" : null)}
        />,
      ),
    );
    await userEvent.click(screen.getByRole("combobox"));

    // The disabled hint is hoisted to the unavailable group's label.
    await screen.findByText(/Unavailable|不可用/i);
    expect(screen.getByText(/no embeddings here/)).toBeInTheDocument();

    // DOM order of options: enabled (audio, chat) first, then disabled (embeddings).
    const options = screen.getAllByRole("option");
    const optionNames = options.map((o) => o.textContent ?? "");
    const audioIdx = optionNames.findIndex((n) => n.includes("audio-conn"));
    const chatIdx = optionNames.findIndex((n) => n.includes("chat-conn"));
    const embIdx = optionNames.findIndex((n) => n.includes("bge-by-mis-tei"));
    expect(audioIdx).toBeLessThan(embIdx);
    expect(chatIdx).toBeLessThan(embIdx);
  });

  it("closed trigger renders only the connection name", async () => {
    (useConnections as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [conn],
      isLoading: false,
    });
    render(withQc(<ConnectionPicker selectedConnectionId="c_1" onSelect={() => {}} />));
    // Trigger contents (combobox name) should be only the connection name —
    // no model, no baseUrl visible in the closed state.
    const trigger = await screen.findByRole("combobox");
    expect(trigger).toHaveTextContent("bge-by-mis-tei");
    expect(trigger.textContent).not.toContain("http://");
    expect(trigger.textContent).not.toContain("gen-studio_bge-m3-uZbs");
  });
});
