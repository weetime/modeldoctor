import { zodResolver } from "@hookform/resolvers/zod";
import { genaiPerfParamsSchema } from "@modeldoctor/tool-adapters/schemas";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GenaiPerfParamsForm } from "../../forms/GenaiPerfParamsForm";

vi.mock("@/lib/api-client", () => ({
  api: { get: vi.fn() },
}));

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

// Category-mismatch warning moved to <ToolUnsupportedNotice>, rendered by
// ToolParamsForm wrapper. See ToolParamsForm.test.tsx for that coverage.
