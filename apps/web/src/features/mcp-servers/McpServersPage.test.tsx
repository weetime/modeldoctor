import "@/lib/i18n";
import type { McpServerPublic } from "@modeldoctor/contracts";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const seedList: McpServerPublic[] = [
  {
    id: "m1",
    userId: "u1",
    name: "higress-gw",
    description: "Gateway MCP",
    transport: "http",
    url: "https://higress.local/mcp",
    authTokenPreview: "sk-...abcd",
    headers: "",
    toolsCache: null,
    toolsCachedAt: null,
    enabled: true,
    createdAt: "2026-07-05T00:00:00Z",
    updatedAt: "2026-07-05T00:00:00Z",
  },
];

const deleteMutate = vi.fn();
const discoverMutate = vi.fn();

vi.mock("./queries", () => ({
  useMcpServers: () => ({ data: seedList, isLoading: false, error: null }),
  useDeleteMcpServer: () => ({ mutate: deleteMutate, isPending: false }),
  useDiscoverMcpServer: () => ({ mutate: discoverMutate, isPending: false }),
  // McpServerSheet imports these — stub so it renders if the sheet ever opens.
  useCreateMcpServer: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateMcpServer: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { McpServersPage } from "./McpServersPage";

describe("McpServersPage", () => {
  beforeEach(() => {
    deleteMutate.mockClear();
    discoverMutate.mockClear();
  });

  it("renders name, url and the create button", () => {
    render(
      <MemoryRouter>
        <McpServersPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("higress-gw")).toBeInTheDocument();
    expect(screen.getByText("https://higress.local/mcp")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /New MCP server|新建 MCP/i })).toBeInTheDocument();
  });

  it("delete flow: opens the confirm dialog and calls delete after typing DELETE", async () => {
    render(
      <MemoryRouter>
        <McpServersPage />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: /actions|操作/i }));
    await userEvent.click(await screen.findByText(/^Delete$|^删除$/));

    const dialog = await screen.findByRole("alertdialog");
    await userEvent.type(within(dialog).getByRole("textbox"), "DELETE");
    const confirmBtn = within(dialog).getByRole("button", { name: /^Delete$|^删除$/ });
    expect(confirmBtn).not.toBeDisabled();
    await userEvent.click(confirmBtn);

    expect(deleteMutate).toHaveBeenCalledWith("m1", expect.anything());
  });

  it("discover flow: the discover action calls the discover mutation with the server id", async () => {
    render(
      <MemoryRouter>
        <McpServersPage />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: /actions|操作/i }));
    await userEvent.click(await screen.findByText(/Discover tools|发现工具/i));

    expect(discoverMutate).toHaveBeenCalledWith("m1", expect.anything());
  });
});
