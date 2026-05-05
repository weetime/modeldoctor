import { zodResolver } from "@hookform/resolvers/zod";
import { guidellmParamsSchema } from "@modeldoctor/tool-adapters/schemas";
import { render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { GuidellmParamsForm } from "../../forms/GuidellmParamsForm";

const wrapperSchema = z.object({ params: guidellmParamsSchema });

function Wrapper({ children, defaults }: { children: React.ReactNode; defaults?: unknown }) {
  const form = useForm({
    resolver: zodResolver(wrapperSchema),
    defaultValues: {
      params: defaults ?? {
        profile: "throughput",
        apiType: "chat",
        datasetName: "random",
        datasetInputTokens: 1024,
        datasetOutputTokens: 128,
        rateType: "constant",
        requestRate: 0,
        totalRequests: 1000,
        maxDurationSeconds: 1800,
        maxConcurrency: 100,
        validateBackend: false,
      },
    },
  });
  return <FormProvider {...form}>{children}</FormProvider>;
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
