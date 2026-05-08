import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FormProvider, useForm } from "react-hook-form";
import { GenaiPerfParamsForm } from "../GenaiPerfParamsForm";

vi.mock("@/features/connections/queries", () => ({
  useConnections: () => ({
    data: [
      {
        id: "c1",
        model: "Qwen/Qwen2.5-0.5B-Instruct",
        tokenizerHfId: null,
        category: "chat",
      },
    ],
  }),
}));

function Harness({ tokenizer }: { tokenizer?: string }) {
  const form = useForm({
    defaultValues: { connectionId: "c1", params: { tokenizer } },
  });
  return (
    <FormProvider {...form}>
      <GenaiPerfParamsForm />
    </FormProvider>
  );
}

describe("GenaiPerfParamsForm tokenizer preview", () => {
  it("shows fallback tokenizer = connection.model when no override", () => {
    render(<Harness />);
    // Open the Advanced details element
    screen.getByText(/Advanced/i).click();
    expect(screen.getByText(/Qwen\/Qwen2\.5-0\.5B-Instruct/)).toBeInTheDocument();
  });

  it("shows the override when params.tokenizer is set", () => {
    render(<Harness tokenizer="custom/Tokenizer" />);
    screen.getByText(/Advanced/i).click();
    expect(screen.getByText(/custom\/Tokenizer/)).toBeInTheDocument();
  });
});
