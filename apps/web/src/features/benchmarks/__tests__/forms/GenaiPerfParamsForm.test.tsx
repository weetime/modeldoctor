import { zodResolver } from "@hookform/resolvers/zod";
import type { ConnectionPublic, ListConnectionsResponse } from "@modeldoctor/contracts";
import { genaiPerfParamsSchema } from "@modeldoctor/tool-adapters/schemas";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GenaiPerfParamsForm } from "../../forms/GenaiPerfParamsForm";

vi.mock("@/lib/api-client", () => ({
  api: { get: vi.fn() },
}));

import { api } from "@/lib/api-client";

const wrapperSchema = z.object({
  connectionId: z.string(),
  params: genaiPerfParamsSchema,
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
  return function Wrapper({ children }: { children: React.ReactNode }) {
    const form = useForm({
      resolver: zodResolver(wrapperSchema),
      defaultValues: {
        connectionId,
        params: {
          endpointType: "chat",
          numPrompts: 100,
          concurrency: 1,
          streaming: true,
          inputTokensStddev: 0,
          outputTokensStddev: 0,
        },
      },
    });
    return (
      <QueryClientProvider client={qc}>
        <FormProvider {...form}>{children}</FormProvider>
      </QueryClientProvider>
    );
  };
}

describe("GenaiPerfParamsForm", () => {
  it("renders all fields", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const SimpleWrapper = ({ children }: { children: React.ReactNode }) => {
      const form = useForm({
        resolver: zodResolver(z.object({ params: genaiPerfParamsSchema })),
        defaultValues: {
          params: {
            endpointType: "chat",
            numPrompts: 100,
            concurrency: 1,
            inputTokensStddev: 0,
            outputTokensStddev: 0,
            streaming: true,
          },
        },
      });
      return (
        <QueryClientProvider client={qc}>
          <FormProvider {...form}>{children}</FormProvider>
        </QueryClientProvider>
      );
    };
    render(
      <SimpleWrapper>
        <GenaiPerfParamsForm />
      </SimpleWrapper>,
    );
    expect(screen.getByLabelText(/endpoint type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/num prompts/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/concurrency/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/streaming/i)).toBeInTheDocument();
  });
});

describe("GenaiPerfParamsForm category warning + endpointType reset", () => {
  it("does not warn when connection is chat (supported)", async () => {
    vi.mocked(api.get).mockResolvedValue({
      items: [fixture("chat")],
    } satisfies ListConnectionsResponse);
    const Wrapper = makeWrapper("c_chat");
    render(
      <Wrapper>
        <GenaiPerfParamsForm />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.queryByText(/不支持|does not support/i)).not.toBeInTheDocument(),
    );
  });

  it("warns when picking an audio connection (genai-perf does not support audio)", async () => {
    vi.mocked(api.get).mockResolvedValue({
      items: [fixture("audio")],
    } satisfies ListConnectionsResponse);
    const Wrapper = makeWrapper("c_audio");
    render(
      <Wrapper>
        <GenaiPerfParamsForm />
      </Wrapper>,
    );
    await waitFor(() => expect(screen.getByText(/不支持|does not support/i)).toBeInTheDocument());
  });

  it("warns when picking an image connection (genai-perf does not support image)", async () => {
    vi.mocked(api.get).mockResolvedValue({
      items: [fixture("image")],
    } satisfies ListConnectionsResponse);
    const Wrapper = makeWrapper("c_image");
    render(
      <Wrapper>
        <GenaiPerfParamsForm />
      </Wrapper>,
    );
    await waitFor(() => expect(screen.getByText(/不支持|does not support/i)).toBeInTheDocument());
  });
});
