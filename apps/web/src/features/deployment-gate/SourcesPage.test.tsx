import "@/lib/i18n";
import type { PlatformSource } from "@modeldoctor/contracts";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const seedList: PlatformSource[] = [
  {
    id: "s1",
    kind: "gpustack",
    name: "prod",
    baseUrl: "http://gs",
    clusterId: null,
    enabled: true,
    lastSyncAt: null,
    lastSyncError: "HTTP 401",
    modelCount: 3,
    createdAt: "",
    updatedAt: "",
  },
];

vi.mock("./queries", () => ({
  useSources: () => ({ isLoading: false, data: seedList }),
  useDeleteSource: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSyncSource: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateSource: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateSource: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTestSource: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { SourcesPage } from "./SourcesPage";

describe("SourcesPage", () => {
  it("renders source row with model count and sync error status", () => {
    render(
      <MemoryRouter>
        <SourcesPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("prod")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText(/同步失败|Sync failed/)).toBeInTheDocument();
  });
});
