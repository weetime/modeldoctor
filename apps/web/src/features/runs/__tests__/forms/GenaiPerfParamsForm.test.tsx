import { zodResolver } from "@hookform/resolvers/zod";
import { genaiPerfParamsSchema } from "@modeldoctor/tool-adapters/schemas";
import { render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { GenaiPerfParamsForm } from "../../forms/GenaiPerfParamsForm";

const wrapperSchema = z.object({ params: genaiPerfParamsSchema });

function Wrapper({ children }: { children: React.ReactNode }) {
  const form = useForm({
    resolver: zodResolver(wrapperSchema),
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
  return <FormProvider {...form}>{children}</FormProvider>;
}

describe("GenaiPerfParamsForm", () => {
  it("renders all fields", () => {
    render(
      <Wrapper>
        <GenaiPerfParamsForm />
      </Wrapper>,
    );
    expect(screen.getByLabelText(/endpoint type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/num prompts/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/concurrency/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/streaming/i)).toBeInTheDocument();
  });
});
