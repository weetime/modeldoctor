import { zodResolver } from "@hookform/resolvers/zod";
import { vegetaParamsSchema } from "@modeldoctor/tool-adapters/schemas";
import { render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { VegetaParamsForm } from "../../forms/VegetaParamsForm";

const wrapperSchema = z.object({ params: vegetaParamsSchema });

function Wrapper({ children }: { children: React.ReactNode }) {
  const form = useForm({
    resolver: zodResolver(wrapperSchema),
    defaultValues: {
      params: { apiType: "chat", rate: 10, duration: 30 },
    },
  });
  return <FormProvider {...form}>{children}</FormProvider>;
}

describe("VegetaParamsForm", () => {
  it("renders apiType, rate, duration fields", () => {
    render(
      <Wrapper>
        <VegetaParamsForm />
      </Wrapper>,
    );
    expect(screen.getByLabelText(/api type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^rate/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/duration/i)).toBeInTheDocument();
  });
});
