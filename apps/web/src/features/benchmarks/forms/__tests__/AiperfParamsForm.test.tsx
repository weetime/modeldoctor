import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FormProvider, useForm } from "react-hook-form";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import { AiperfParamsForm } from "../AiperfParamsForm";

function Harness({ defaultDataset = "synthetic" }: { defaultDataset?: string } = {}) {
  const form = useForm({
    defaultValues: {
      params: {
        dataset: defaultDataset,
        concurrency: 8,
        requestCount: 100,
      },
    },
  });
  return (
    <I18nextProvider i18n={i18n}>
      <FormProvider {...form}>
        <AiperfParamsForm />
      </FormProvider>
    </I18nextProvider>
  );
}

describe("AiperfParamsForm", () => {
  it("renders core fields regardless of dataset", () => {
    render(<Harness />);
    expect(screen.getByText(/Concurrency|并发数/)).toBeInTheDocument();
    expect(screen.getByText(/Request count|请求数/)).toBeInTheDocument();
    expect(screen.getByText(/Dataset|数据集/)).toBeInTheDocument();
    expect(screen.getByText(/Streaming|流式响应/)).toBeInTheDocument();
    expect(screen.getByText(/Seed|随机种子/)).toBeInTheDocument();
  });

  it("shows conversation fields (not mooncake) when dataset=synthetic", () => {
    render(<Harness defaultDataset="synthetic" />);
    expect(screen.getByText(/Conversation count|会话数/)).toBeInTheDocument();
    expect(screen.getByText(/Turn mean|每轮对话均值/)).toBeInTheDocument();
    expect(screen.getByText(/Conversation type|会话类型/)).toBeInTheDocument();
    expect(screen.queryByText(/Mooncake trace type|Mooncake Trace 类型/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ISL block size|ISL 块大小/)).not.toBeInTheDocument();
  });

  it("shows conversation fields (not mooncake) when dataset=sharegpt", () => {
    render(<Harness defaultDataset="sharegpt" />);
    expect(screen.getByText(/Conversation count|会话数/)).toBeInTheDocument();
    expect(screen.queryByText(/Mooncake trace type|Mooncake Trace 类型/)).not.toBeInTheDocument();
  });

  it("shows mooncake fields (not conversation) when dataset=mooncake-trace", () => {
    render(<Harness defaultDataset="mooncake-trace" />);
    expect(screen.getByText(/Mooncake trace type|Mooncake Trace 类型/)).toBeInTheDocument();
    expect(screen.getByText(/ISL block size|ISL 块大小/)).toBeInTheDocument();
    expect(screen.queryByText(/Conversation count|会话数/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Turn mean|每轮对话均值/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Conversation type|会话类型/)).not.toBeInTheDocument();
  });

  it("renders correctly when dataset is already mooncake-trace (option is a valid value)", () => {
    // Verifies the DATASETS constant includes mooncake-trace by rendering with it as default
    render(<Harness defaultDataset="mooncake-trace" />);
    // When dataset=mooncake-trace the trigger shows the current value
    expect(screen.getByText("mooncake-trace")).toBeInTheDocument();
  });
});
