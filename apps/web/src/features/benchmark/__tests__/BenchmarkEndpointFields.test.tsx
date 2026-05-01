import type { ConnectionPublic } from "@modeldoctor/contracts";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import type { CreateBenchmarkRequest } from "../schemas";

const SAMPLE_CONN: ConnectionPublic = {
  id: "c1",
  userId: "u1",
  name: "bench-1",
  baseUrl: "http://x.test",
  apiKeyPreview: "sk-...1234",
  model: "llama-3-8b",
  customHeaders: "",
  queryParams: "",
  category: "chat",
  tags: [],
  createdAt: "2026-04-26T14:22:00Z",
  updatedAt: "2026-04-26T14:22:00Z",
};

vi.mock("@/features/connections/queries", () => ({
  useConnections: () => ({ data: [SAMPLE_CONN], isLoading: false, error: null }),
  useConnection: (id: string | null | undefined) => ({
    data: id === "c1" ? SAMPLE_CONN : null,
    isLoading: false,
    error: null,
  }),
}));

import { BenchmarkEndpointFields } from "../BenchmarkEndpointFields";

const DEFAULT_FORM_VALUES: CreateBenchmarkRequest = {
  name: "",
  profile: "throughput",
  apiType: "chat",
  connectionId: "",
  datasetName: "random",
  requestRate: 0,
  totalRequests: 1000,
};

function Harness({
  defaultValues,
  connectionMissing,
}: {
  defaultValues?: Partial<CreateBenchmarkRequest>;
  connectionMissing?: boolean;
}) {
  const form = useForm<CreateBenchmarkRequest>({
    defaultValues: { ...DEFAULT_FORM_VALUES, ...defaultValues },
  });
  return (
    <FormProvider {...form}>
      <BenchmarkEndpointFields connectionMissing={connectionMissing} />
    </FormProvider>
  );
}

describe("BenchmarkEndpointFields", () => {
  it("renders the connection picker and the apiType selector", () => {
    render(<Harness />);
    expect(screen.getByText(/Load from saved connection|从已保存连接加载/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/api type/i)).toBeInTheDocument();
  });

  it("apiType select offers chat and completion only", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByLabelText(/api type/i));
    expect(screen.getByRole("option", { name: /chat/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /completion/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /embedding/i })).toBeNull();
  });

  it("renders read-only connection metadata when a connection is pre-selected", () => {
    render(<Harness defaultValues={{ connectionId: "c1" }} />);
    expect(screen.getByText("http://x.test")).toBeInTheDocument();
    expect(screen.getByText("llama-3-8b")).toBeInTheDocument();
    expect(screen.getByText("sk-...1234")).toBeInTheDocument();
  });

  it("renders the savedConnectionMissing error when connectionMissing is true", () => {
    render(<Harness connectionMissing={true} />);
    expect(screen.getByText(/no longer exists|已被删除/i)).toBeInTheDocument();
  });
});
