import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";

// Mock the queries hooks before importing anything that uses them
vi.mock("@/features/connections/queries", () => ({
  useConnection: vi.fn(),
  useConnections: vi.fn(() => ({ data: [], isLoading: false })),
}));

// Mock ConnectionDialog so we can assert its props without rendering internals
const MockConnectionDialog = vi.fn();
vi.mock("@/features/connections/ConnectionDialog", () => ({
  ConnectionDialog: (props: Record<string, unknown>) => {
    MockConnectionDialog(props);
    return null;
  },
}));

import { useConnection } from "@/features/connections/queries";
import { EndpointPicker } from "./EndpointPicker";

const SAMPLE = {
  id: "c1",
  userId: "u1",
  name: "vllm-prod",
  baseUrl: "http://example.com",
  apiKeyPreview: "sk-...abcd",
  model: "qwen2.5",
  customHeaders: "X-Foo: bar",
  queryParams: "key=val",
  category: "chat" as const,
  tags: [] as string[],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const SAMPLE_ENDPOINT = {
  apiBaseUrl: SAMPLE.baseUrl,
  apiKey: SAMPLE.apiKeyPreview,
  model: SAMPLE.model,
  customHeaders: SAMPLE.customHeaders,
  queryParams: SAMPLE.queryParams,
};

describe("EndpointPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockConnectionDialog.mockClear();
  });

  it("renders fields read-only after a connection is selected", () => {
    (useConnection as ReturnType<typeof vi.fn>).mockReturnValue({
      data: SAMPLE,
      isLoading: false,
    });
    render(
      <EndpointPicker
        endpoint={SAMPLE_ENDPOINT}
        selectedConnectionId="c1"
        onSelect={() => {}}
        onEndpointChange={() => {}}
      />,
    );
    // API Base URL field is read-only
    const urlInput = screen.getByDisplayValue("http://example.com");
    expect(urlInput).toHaveAttribute("readonly");
    // API Key preview field is read-only
    const keyInput = screen.getByDisplayValue("sk-...abcd");
    expect(keyInput).toHaveAttribute("readonly");
    // Model field is read-only
    const modelInput = screen.getByDisplayValue("qwen2.5");
    expect(modelInput).toHaveAttribute("readonly");
  });

  it("Edit button opens ConnectionDialog in edit mode with the existing connection", () => {
    (useConnection as ReturnType<typeof vi.fn>).mockReturnValue({
      data: SAMPLE,
      isLoading: false,
    });
    render(
      <EndpointPicker
        endpoint={SAMPLE_ENDPOINT}
        selectedConnectionId="c1"
        onSelect={() => {}}
        onEndpointChange={() => {}}
      />,
    );
    // Click the "Edit this connection" button
    fireEvent.click(screen.getByText(/Edit this connection|编辑此连接/i));
    // ConnectionDialog should have been called with mode={ kind: "edit", existing: SAMPLE }
    expect(MockConnectionDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: { kind: "edit", existing: SAMPLE },
      }),
    );
  });

  it("Save-as button opens ConnectionDialog in create mode prefilled without apiKey", () => {
    (useConnection as ReturnType<typeof vi.fn>).mockReturnValue({
      data: SAMPLE,
      isLoading: false,
    });
    render(
      <EndpointPicker
        endpoint={SAMPLE_ENDPOINT}
        selectedConnectionId="c1"
        onSelect={() => {}}
        onEndpointChange={() => {}}
      />,
    );
    // Click the "Save as new connection" button
    fireEvent.click(screen.getByText(/Save as new connection|另存为新连接/i));
    // Find the call where open=true (initial render emits open=false)
    const allCalls = MockConnectionDialog.mock.calls as Array<[Record<string, unknown>]>;
    const callWithOpen = allCalls.find((call) => call[0]?.open === true);
    expect(callWithOpen).toBeDefined();
    const props = (callWithOpen as [Record<string, unknown>])[0];
    expect(props.mode).toEqual({ kind: "create" });
    // initialValues carries everything except apiKey
    expect(props.initialValues).toEqual(
      expect.objectContaining({
        name: `${SAMPLE.name}-copy`,
        apiBaseUrl: SAMPLE.baseUrl,
        model: SAMPLE.model,
        customHeaders: SAMPLE.customHeaders,
        queryParams: SAMPLE.queryParams,
        category: SAMPLE.category,
        tags: SAMPLE.tags,
      }),
    );
    // apiKey must NOT be present in the prefill
    expect(props.initialValues).not.toHaveProperty("apiKey");
  });
});
