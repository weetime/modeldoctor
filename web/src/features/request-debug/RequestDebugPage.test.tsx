import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { RequestDebugPage } from "./RequestDebugPage";
import { useDebugStore } from "./store";
import type { DebugProxyResponse } from "./types";

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
	return (
		<MemoryRouter>
			<QueryClientProvider client={qc}>{children}</QueryClientProvider>
		</MemoryRouter>
	);
}

const PROXY_OK: DebugProxyResponse = {
	success: true,
	status: 200,
	statusText: "OK",
	headers: { "content-type": "application/json" },
	body: '{"ok": true}',
	bodyEncoding: "text",
	timingMs: { ttfbMs: 12, totalMs: 34 },
	sizeBytes: 12,
};

const PROXY_ERR: DebugProxyResponse = {
	success: false,
	error: "connection refused",
};

describe("RequestDebugPage (happy path)", () => {
	beforeEach(() => {
		localStorage.clear();
		useDebugStore.getState().reset();
		vi.mocked(api.post).mockReset();
	});

	it("Send posts to /api/debug/proxy with the form contents", async () => {
		vi.mocked(api.post).mockResolvedValue(PROXY_OK);
		const user = userEvent.setup();
		render(
			<Wrapper>
				<RequestDebugPage />
			</Wrapper>,
		);

		await user.type(
			screen.getByLabelText(/url/i),
			"http://host/v1/chat/completions",
		);

		const sendButtons = screen.getAllByRole("button", { name: /send|发送/i });
		await user.click(sendButtons[sendButtons.length - 1]);

		await waitFor(() => {
			expect(api.post).toHaveBeenCalledWith(
				"/api/debug/proxy",
				expect.objectContaining({
					method: "POST",
					url: "http://host/v1/chat/completions",
				}),
			);
		});

		await waitFor(() => {
			expect(useDebugStore.getState().lastResponse?.status).toBe(200);
		});
	});

	it("stores lastError when the proxy reports failure", async () => {
		vi.mocked(api.post).mockResolvedValue(PROXY_ERR);
		const user = userEvent.setup();
		render(
			<Wrapper>
				<RequestDebugPage />
			</Wrapper>,
		);

		await user.type(screen.getByLabelText(/url/i), "http://bad-host/");
		const sendButtons = screen.getAllByRole("button", { name: /send|发送/i });
		await user.click(sendButtons[sendButtons.length - 1]);

		await waitFor(() => {
			expect(useDebugStore.getState().lastError).toBe("connection refused");
		});
		expect(useDebugStore.getState().lastResponse).toBeNull();
	});

	it("Clear button calls resetResults", async () => {
		useDebugStore.getState().setLastResponse({
			status: 200,
			statusText: "OK",
			headers: {},
			body: '{"seeded": true}',
			bodyEncoding: "text",
			timingMs: { ttfbMs: 1, totalMs: 1 },
			sizeBytes: 16,
		});
		useDebugStore.getState().patch("url", "http://host/x");

		const user = userEvent.setup();
		render(
			<Wrapper>
				<RequestDebugPage />
			</Wrapper>,
		);

		const clearButtons = screen.getAllByRole("button", { name: /clear|清空/i });
		await user.click(clearButtons[0]);

		await waitFor(() => {
			expect(useDebugStore.getState().lastResponse).toBeNull();
		});
		// Form config untouched.
		expect(useDebugStore.getState().url).toBe("http://host/x");
	});
});
