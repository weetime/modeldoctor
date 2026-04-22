import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { LoadTestPage } from "./LoadTestPage";
import { useLoadTestStore } from "./store";
import type { LoadTestResult } from "./types";

vi.mock("@/lib/api-client", () => {
	class ApiError extends Error {
		status: number;
		constructor(status: number, message: string) {
			super(message);
			this.status = status;
		}
	}
	return {
		ApiError,
		api: { get: vi.fn(), post: vi.fn() },
	};
});

import { api } from "@/lib/api-client";

function Wrapper({ children }: { children: ReactNode }) {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const FAKE_RESULT: LoadTestResult = {
	report:
		"Requests      [total, rate, throughput]  120, 2.00, 2.00\nLatencies     [mean, 50, 95, 99, max]  5ms, 5ms, 6ms, 7ms, 9ms",
	parsed: {
		requests: 120,
		success: 120,
		throughput: 2,
		latencies: { mean: "5ms", p50: "5ms", p95: "6ms", p99: "7ms", max: "9ms" },
	},
	config: { apiUrl: "http://host/v1/chat/completions", rate: 2, duration: 60 },
};

describe("LoadTestPage (happy path)", () => {
	beforeEach(() => {
		localStorage.clear();
		useLoadTestStore.getState().reset();
		vi.mocked(api.post).mockReset();
	});

	it("Start posts to /api/load-test and renders metrics", async () => {
		vi.mocked(api.post).mockResolvedValue(FAKE_RESULT);
		const user = userEvent.setup();
		render(
			<Wrapper>
				<LoadTestPage />
			</Wrapper>,
		);

		await user.type(
			screen.getByLabelText(/api url/i),
			"http://host/v1/chat/completions",
		);
		await user.type(screen.getByLabelText(/api key/i), "sk-test");
		await user.type(screen.getByLabelText(/^model$/i), "test-model");

		await user.click(screen.getByRole("button", { name: /^(start|开始)$/i }));

		await waitFor(() => {
			// "总请求数" / "Total" label appears once the result renders
			expect(screen.getAllByText(/120/).length).toBeGreaterThan(0);
		});

		expect(api.post).toHaveBeenCalledWith(
			"/api/load-test",
			expect.objectContaining({
				apiType: "chat",
				apiUrl: "http://host/v1/chat/completions",
				apiKey: "sk-test",
				model: "test-model",
			}),
		);
	});

	it("Reset clears the last result from view", async () => {
		useLoadTestStore.getState().setLastResult(FAKE_RESULT);
		const user = userEvent.setup();
		render(
			<Wrapper>
				<LoadTestPage />
			</Wrapper>,
		);

		expect(screen.getAllByText(/120/).length).toBeGreaterThan(0);
		await user.click(screen.getByRole("button", { name: /^(reset|重置)$/i }));

		await waitFor(() => {
			expect(screen.queryAllByText(/120/).length).toBe(0);
		});
		expect(useLoadTestStore.getState().lastResult).toBeNull();
	});
});
