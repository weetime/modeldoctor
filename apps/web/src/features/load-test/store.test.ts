import { beforeEach, describe, expect, it } from "vitest";
import { useLoadTestStore } from "./store";
import type { LoadTestResult } from "./types";

const PERSIST_KEY = "md.load-test.v1";

const FAKE_RESULT: LoadTestResult = {
	report: "Requests [total] 120",
	parsed: {
		requests: 120,
		success: 120,
		throughput: 2,
		latencies: { mean: "5ms", p50: "5ms", p95: "6ms", p99: "7ms", max: "9ms" },
	},
	config: { apiUrl: "http://a" },
};

function storedState(): Record<string, unknown> | null {
	const raw = localStorage.getItem(PERSIST_KEY);
	if (!raw) return null;
	return (JSON.parse(raw) as { state: Record<string, unknown> }).state;
}

describe("useLoadTestStore", () => {
	beforeEach(() => {
		localStorage.clear();
		useLoadTestStore.getState().reset();
	});

	it("starts with factory defaults", () => {
		const s = useLoadTestStore.getState();
		expect(s.selectedConnectionId).toBeNull();
		expect(s.apiType).toBe("chat");
		expect(s.lastResult).toBeNull();
		expect(s.error).toBeNull();
		expect(s.progress).toBe(0);
		expect(s.chat.prompt).toBe("What is the meaning of life?");
	});

	it("resetResults clears runtime output, preserves form config", () => {
		const s = useLoadTestStore.getState();
		s.patch("chat", { ...s.chat, prompt: "custom prompt" });
		s.patch("attack", { rate: 10, duration: 30 });
		s.setLastResult(FAKE_RESULT);
		s.setError("boom");
		s.setProgress(50);

		useLoadTestStore.getState().resetResults();
		const after = useLoadTestStore.getState();
		expect(after.lastResult).toBeNull();
		expect(after.error).toBeNull();
		expect(after.progress).toBe(0);
		// Form config untouched.
		expect(after.chat.prompt).toBe("custom prompt");
		expect(after.attack).toEqual({ rate: 10, duration: 30 });
	});

	it("reset reverts everything including form config", () => {
		const s = useLoadTestStore.getState();
		s.patch("chat", { ...s.chat, prompt: "changed" });
		s.setLastResult(FAKE_RESULT);

		useLoadTestStore.getState().reset();
		const after = useLoadTestStore.getState();
		expect(after.chat.prompt).toBe("What is the meaning of life?");
		expect(after.lastResult).toBeNull();
	});

	it("does not persist lastResult / error / progress", () => {
		const s = useLoadTestStore.getState();
		s.patch("chat", { ...s.chat, prompt: "persisted prompt" });
		s.setLastResult(FAKE_RESULT);
		s.setError("should-not-persist");
		s.setProgress(77);

		const persisted = storedState();
		expect(persisted).not.toBeNull();
		expect(persisted).not.toHaveProperty("lastResult");
		expect(persisted).not.toHaveProperty("error");
		expect(persisted).not.toHaveProperty("progress");
		// User input IS persisted.
		expect((persisted as { chat: { prompt: string } }).chat.prompt).toBe(
			"persisted prompt",
		);
	});
});
