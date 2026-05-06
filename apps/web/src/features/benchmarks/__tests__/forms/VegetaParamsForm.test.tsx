import { zodResolver } from "@hookform/resolvers/zod";
import type { ConnectionPublic, ListConnectionsResponse } from "@modeldoctor/contracts";
import { vegetaParamsSchema } from "@modeldoctor/tool-adapters/schemas";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { VegetaParamsForm } from "../../forms/VegetaParamsForm";

vi.mock("@/lib/api-client", () => ({
  api: {
    get: vi.fn(),
  },
}));

import { api } from "@/lib/api-client";

const wrapperSchema = z.object({
  connectionId: z.string(),
  params: vegetaParamsSchema,
});

const baseConnection: ConnectionPublic = {
  id: "c_emb",
  userId: "u_1",
  name: "bge-by-mis-tei",
  baseUrl: "http://example/v1",
  apiKeyPreview: "sk-...bc8d",
  model: "bge-m3-uZbs",
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

function makeWrapper(initialConnectionId = "") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    const form = useForm({
      resolver: zodResolver(wrapperSchema),
      defaultValues: {
        connectionId: initialConnectionId,
        params: {
          apiType: "chat",
          rate: 10,
          duration: 30,
          path: "/v1/chat/completions",
          body: '{"model":"x","messages":[{"role":"user","content":"hello"}]}',
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

describe("VegetaParamsForm", () => {
  it("renders apiType, rate, duration fields", () => {
    vi.mocked(api.get).mockResolvedValue({
      items: [baseConnection],
    } satisfies ListConnectionsResponse);
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <VegetaParamsForm />
      </Wrapper>,
    );
    expect(screen.getByLabelText(/api type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^rate/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/duration/i)).toBeInTheDocument();
  });

  it("hides path + body fields by default (Advanced collapsed)", () => {
    vi.mocked(api.get).mockResolvedValue({
      items: [baseConnection],
    } satisfies ListConnectionsResponse);
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <VegetaParamsForm />
      </Wrapper>,
    );
    const advanced = screen.getByText(/advanced/i).closest("details");
    expect(advanced).not.toBeNull();
    expect((advanced as HTMLDetailsElement).open).toBe(false);
  });

  it("exposes path + body inputs once Advanced is opened", () => {
    vi.mocked(api.get).mockResolvedValue({
      items: [baseConnection],
    } satisfies ListConnectionsResponse);
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <VegetaParamsForm />
      </Wrapper>,
    );
    fireEvent.click(screen.getByText(/advanced/i));
    expect(screen.getByLabelText(/^path/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^body/i)).toBeInTheDocument();
  });

  it("resets apiType + path + body when an embedding connection is selected", async () => {
    vi.mocked(api.get).mockResolvedValue({
      items: [baseConnection],
    } satisfies ListConnectionsResponse);

    // Start with no connectionId; render the form, then bump connectionId
    // through the form-state to simulate connection picker selection.
    function Harness() {
      const form = useForm({
        resolver: zodResolver(wrapperSchema),
        defaultValues: {
          connectionId: "",
          params: {
            apiType: "chat",
            rate: 10,
            duration: 30,
            path: "/v1/chat/completions",
            body: '{"model":"x","messages":[{"role":"user","content":"hello"}]}',
          },
        },
      });

      return (
        <FormProvider {...form}>
          <button
            type="button"
            data-testid="pick-connection"
            onClick={() => form.setValue("connectionId", "c_emb", { shouldDirty: false })}
          />
          <VegetaParamsForm />
        </FormProvider>
      );
    }
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { getByTestId } = render(
      <QueryClientProvider client={qc}>
        <Harness />
      </QueryClientProvider>,
    );

    // Open Advanced so we can read path/body input values.
    fireEvent.click(screen.getByText(/advanced/i));

    // Confirm initial values reflect the form defaults (chat).
    expect(screen.getByLabelText(/^path/i)).toHaveValue("/v1/chat/completions");

    // Simulate user picking the embeddings connection.
    fireEvent.click(getByTestId("pick-connection"));

    // After all effects settle, apiType / path / body all reflect embeddings.
    await waitFor(() => {
      expect(screen.getByLabelText(/^path/i)).toHaveValue("/v1/embeddings");
    });
    const body = (screen.getByLabelText(/^body/i) as HTMLTextAreaElement).value;
    expect(JSON.parse(body)).toEqual({ model: "bge-m3-uZbs", input: "hello" });
  });
});
