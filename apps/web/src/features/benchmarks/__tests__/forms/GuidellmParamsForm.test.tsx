import { zodResolver } from "@hookform/resolvers/zod";
import type { ConnectionPublic, ListConnectionsResponse } from "@modeldoctor/contracts";
import { guidellmParamsSchema } from "@modeldoctor/tool-adapters/schemas";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GuidellmParamsForm } from "../../forms/GuidellmParamsForm";

vi.mock("@/lib/api-client", () => ({
  api: { get: vi.fn() },
}));

import { api } from "@/lib/api-client";

const simpleSchema = z.object({ params: guidellmParamsSchema });

const defaultParams = {
  profile: "throughput" as const,
  apiType: "chat" as const,
  datasetName: "random" as const,
  datasetInputTokens: 1024,
  datasetOutputTokens: 128,
  rateType: "constant" as const,
  requestRate: 0,
  totalRequests: 1000,
  maxDurationSeconds: 1800,
  maxConcurrency: 100,
  validateBackend: false,
};

function Wrapper({ children, defaults }: { children: React.ReactNode; defaults?: unknown }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const form = useForm({
    resolver: zodResolver(simpleSchema),
    defaultValues: {
      params: defaults ?? defaultParams,
    },
  });
  return (
    <QueryClientProvider client={qc}>
      <FormProvider {...form}>{children}</FormProvider>
    </QueryClientProvider>
  );
}

const connectionSchema = z.object({
  connectionId: z.string(),
  params: guidellmParamsSchema,
});

function fixture(category: ConnectionPublic["category"]): ConnectionPublic {
  return {
    id: `c_${category}`,
    userId: "u_1",
    name: `n-${category}`,
    baseUrl: "http://example/",
    apiKeyPreview: "sk-...x",
    model: "m",
    customHeaders: "",
    queryParams: "",
    category,
    tags: [],
    prometheusUrl: null,
    serverKind: null,
    tokenizerHfId: null,
    createdAt: "2026-05-06T00:00:00.000Z",
    updatedAt: "2026-05-06T00:00:00.000Z",
  };
}

function makeWrapper(connectionId: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function ConnectionWrapper({ children }: { children: React.ReactNode }) {
    const form = useForm({
      resolver: zodResolver(connectionSchema),
      defaultValues: {
        connectionId,
        params: defaultParams,
      },
    });
    return (
      <QueryClientProvider client={qc}>
        <FormProvider {...form}>{children}</FormProvider>
      </QueryClientProvider>
    );
  };
}

describe("GuidellmParamsForm", () => {
  it("renders all primary fields", () => {
    render(
      <Wrapper>
        <GuidellmParamsForm />
      </Wrapper>,
    );
    expect(screen.getByLabelText(/profile/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/total requests/i)).toBeInTheDocument();
    // rateType=constant → requestRate visible, maxConcurrency hidden.
    expect(screen.getByLabelText(/request rate/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/max concurrency/i)).not.toBeInTheDocument();
  });

  it("shows datasetInputTokens + datasetOutputTokens when datasetName === random", () => {
    render(
      <Wrapper>
        <GuidellmParamsForm />
      </Wrapper>,
    );
    expect(screen.getByLabelText(/input tokens/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/output tokens/i)).toBeInTheDocument();
  });

  it("hides Input/Output tokens when datasetName === sharegpt", () => {
    render(
      <Wrapper
        defaults={{
          profile: "sharegpt",
          apiType: "chat",
          datasetName: "sharegpt",
          rateType: "constant",
          requestRate: 1,
          totalRequests: 1000,
          maxDurationSeconds: 1800,
          maxConcurrency: 100,
          validateBackend: false,
        }}
      >
        <GuidellmParamsForm />
      </Wrapper>,
    );
    expect(screen.queryByLabelText(/input tokens/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/output tokens/i)).not.toBeInTheDocument();
  });

  it("hides Request rate + shows Max concurrency when rateType === throughput", () => {
    render(
      <Wrapper
        defaults={{
          profile: "throughput",
          apiType: "chat",
          datasetName: "random",
          datasetInputTokens: 1024,
          datasetOutputTokens: 128,
          rateType: "throughput",
          requestRate: 0,
          totalRequests: 1000,
          maxDurationSeconds: 1800,
          maxConcurrency: 100,
          validateBackend: false,
        }}
      >
        <GuidellmParamsForm />
      </Wrapper>,
    );
    expect(screen.queryByLabelText(/request rate/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/max concurrency/i)).toBeInTheDocument();
  });
});

describe("GuidellmParamsForm category warning", () => {
  it("shows no warning when connection category is chat", async () => {
    vi.mocked(api.get).mockResolvedValue({
      items: [fixture("chat")],
    } satisfies ListConnectionsResponse);
    const Wrapper = makeWrapper("c_chat");
    render(
      <Wrapper>
        <GuidellmParamsForm />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.queryByText(/不支持|does not support/i)).not.toBeInTheDocument(),
    );
  });

  it("shows a warning when connection category is embeddings", async () => {
    vi.mocked(api.get).mockResolvedValue({
      items: [fixture("embeddings")],
    } satisfies ListConnectionsResponse);
    const Wrapper = makeWrapper("c_embeddings");
    render(
      <Wrapper>
        <GuidellmParamsForm />
      </Wrapper>,
    );
    await waitFor(() => expect(screen.getByText(/不支持|does not support/i)).toBeInTheDocument());
  });
});
