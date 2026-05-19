import i18n from "@/lib/i18n";
import { render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import { PrefixCacheProbeParamsForm } from "../PrefixCacheProbeParamsForm";

const mockUseConnections = vi.fn();
vi.mock("@/features/connections/queries", () => ({
  useConnections: () => mockUseConnections(),
}));

function Harness({
  connectionId,
  hasDatasource,
}: { connectionId: string; hasDatasource: boolean }) {
  mockUseConnections.mockReturnValue({
    data: [
      {
        id: connectionId,
        prometheusDatasource: hasDatasource
          ? { id: "ds1", name: "default", baseUrl: "http://prom:9090" }
          : null,
      },
    ],
  });
  const form = useForm({ defaultValues: { connectionId, params: {} } });
  return (
    <I18nextProvider i18n={i18n}>
      <FormProvider {...form}>
        <PrefixCacheProbeParamsForm />
      </FormProvider>
    </I18nextProvider>
  );
}

describe("PrefixCacheProbeParamsForm", () => {
  it("renders four numeric fields when a Prometheus datasource is bound", () => {
    render(<Harness connectionId="c1" hasDatasource />);
    expect(screen.getByText(/Prompt sets|前缀组数/)).toBeInTheDocument();
    expect(screen.getByText(/Requests per set|每组请求数/)).toBeInTheDocument();
    expect(screen.getByText(/Max output tokens|最大输出/)).toBeInTheDocument();
    expect(screen.getByText(/Prom scrape wait|抓取等待/)).toBeInTheDocument();
  });

  it("shows blocking alert when connection.prometheusDatasource is null", () => {
    render(<Harness connectionId="c1" hasDatasource={false} />);
    expect(
      screen.getByText(/cannot run prefix-cache validation|无法运行 prefix-cache/i),
    ).toBeInTheDocument();
  });
});
