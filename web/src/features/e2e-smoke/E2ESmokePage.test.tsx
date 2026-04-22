import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { E2ESmokePage } from "./E2ESmokePage";
import { useE2EStore } from "./store";
import type { E2ETestResponse } from "./types";

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

describe("E2ESmokePage (happy path)", () => {
	beforeEach(() => {
		localStorage.clear();
		useE2EStore.getState().reset();
		vi.mocked(api.post).mockReset();
	});

	it("Run All is disabled until endpoint fields are filled", async () => {
		render(<E2ESmokePage />);
		const runAll = screen.getByRole("button", { name: /run all/i });
		expect(runAll).toBeDisabled();

		const user = userEvent.setup();
		await user.type(
			screen.getByLabelText(/api url/i),
			"http://host/v1/chat/completions",
		);
		await user.type(screen.getByLabelText(/api key/i), "sk-test");
		await user.type(screen.getByLabelText(/^model$/i), "test-model");

		expect(runAll).toBeEnabled();
	});

	it("Run All posts to /api/e2e-test and renders three Pass cards", async () => {
		const response: E2ETestResponse = {
			success: true,
			results: [
				{
					probe: "text",
					pass: true,
					latencyMs: 12,
					checks: [{ name: "HTTP status 200", pass: true, info: "200" }],
					details: { content: "OK-TEXT-123" },
				},
				{
					probe: "image",
					pass: true,
					latencyMs: 34,
					checks: [{ name: "Reply mentions 'cat'", pass: true }],
					details: { content: "Cat" },
				},
				{
					probe: "audio",
					pass: true,
					latencyMs: 56,
					checks: [{ name: "Valid WAV header", pass: true }],
					details: { numChoices: 1 },
				},
			],
		};
		vi.mocked(api.post).mockResolvedValue(response);

		const user = userEvent.setup();
		render(<E2ESmokePage />);
		await user.type(
			screen.getByLabelText(/api url/i),
			"http://host/v1/chat/completions",
		);
		await user.type(screen.getByLabelText(/api key/i), "sk-test");
		await user.type(screen.getByLabelText(/^model$/i), "test-model");

		await user.click(screen.getByRole("button", { name: /run all/i }));

		await waitFor(() => {
			const badges = screen.getAllByText(/^(pass|通过)$/i);
			expect(badges).toHaveLength(3);
		});

		expect(api.post).toHaveBeenCalledWith(
			"/api/e2e-test",
			expect.objectContaining({
				apiUrl: "http://host/v1/chat/completions",
				apiKey: "sk-test",
				model: "test-model",
				probes: ["text", "image", "audio"],
			}),
		);
	});

	it("renders Fail badges when probes return pass=false", async () => {
		vi.mocked(api.post).mockResolvedValue({
			success: true,
			results: [
				{
					probe: "text",
					pass: false,
					latencyMs: 10,
					checks: [{ name: "HTTP status 200", pass: false, info: "500" }],
					details: {},
				},
				{
					probe: "image",
					pass: false,
					latencyMs: 10,
					checks: [],
					details: {},
				},
				{
					probe: "audio",
					pass: false,
					latencyMs: 10,
					checks: [],
					details: {},
				},
			],
		});

		const user = userEvent.setup();
		render(<E2ESmokePage />);
		await user.type(
			screen.getByLabelText(/api url/i),
			"http://host/v1/chat/completions",
		);
		await user.type(screen.getByLabelText(/api key/i), "sk-test");
		await user.type(screen.getByLabelText(/^model$/i), "test-model");
		await user.click(screen.getByRole("button", { name: /run all/i }));

		await waitFor(() => {
			const fails = screen.getAllByText(/^(fail|失败)$/i);
			expect(fails).toHaveLength(3);
		});
	});
});

// Silence: helper unused in this file but kept for when we expand
void within;
