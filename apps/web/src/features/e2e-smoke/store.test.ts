import { beforeEach, describe, expect, it } from "vitest";
import { useE2EStore } from "./store";

const PERSIST_KEY = "md.e2e.v1";

function storedState(): Record<string, unknown> | null {
	const raw = localStorage.getItem(PERSIST_KEY);
	if (!raw) return null;
	return (JSON.parse(raw) as { state: Record<string, unknown> }).state;
}

describe("useE2EStore", () => {
	beforeEach(() => {
		localStorage.clear();
		useE2EStore.getState().reset();
	});

	it("starts with empty endpoint, no selection, no results", () => {
		const s = useE2EStore.getState();
		expect(s.selectedConnectionId).toBeNull();
		expect(s.manualEndpoint).toEqual({
			apiUrl: "",
			apiKey: "",
			model: "",
			customHeaders: "",
			queryParams: "",
		});
		expect(s.results).toEqual({ text: null, image: null, audio: null });
		expect(s.running).toEqual({ text: false, image: false, audio: false });
	});

	it("setResult / setRunning update the specific probe only", () => {
		useE2EStore.getState().setRunning("text", true);
		useE2EStore.getState().setResult("image", {
			pass: true,
			latencyMs: 42,
			checks: [],
			details: {},
		});
		const s = useE2EStore.getState();
		expect(s.running).toEqual({ text: true, image: false, audio: false });
		expect(s.results.image?.pass).toBe(true);
		expect(s.results.text).toBeNull();
		expect(s.results.audio).toBeNull();
	});

	it("resetResults clears outputs but preserves endpoint + selection", () => {
		const store = useE2EStore.getState();
		store.setSelected("conn-1");
		store.setManualEndpoint({
			apiUrl: "http://a",
			apiKey: "k",
			model: "m",
			customHeaders: "",
			queryParams: "",
		});
		store.setResult("text", {
			pass: false,
			latencyMs: 5,
			checks: [],
			details: {},
		});
		store.setRunning("audio", true);

		useE2EStore.getState().resetResults();
		const s = useE2EStore.getState();
		expect(s.selectedConnectionId).toBe("conn-1");
		expect(s.manualEndpoint.apiUrl).toBe("http://a");
		expect(s.results).toEqual({ text: null, image: null, audio: null });
		expect(s.running).toEqual({ text: false, image: false, audio: false });
	});

	it("reset clears everything including endpoint and selection", () => {
		const store = useE2EStore.getState();
		store.setSelected("conn-1");
		store.setManualEndpoint({
			apiUrl: "http://a",
			apiKey: "k",
			model: "m",
			customHeaders: "",
			queryParams: "",
		});
		store.setResult("text", {
			pass: true,
			latencyMs: 1,
			checks: [],
			details: {},
		});

		useE2EStore.getState().reset();
		const s = useE2EStore.getState();
		expect(s.selectedConnectionId).toBeNull();
		expect(s.manualEndpoint.apiUrl).toBe("");
		expect(s.results.text).toBeNull();
	});

	it("persists only selection + endpoint, not transient results/running", () => {
		const store = useE2EStore.getState();
		store.setSelected("conn-1");
		store.setManualEndpoint({
			apiUrl: "http://x",
			apiKey: "k",
			model: "m",
			customHeaders: "",
			queryParams: "",
		});
		store.setResult("text", {
			pass: true,
			latencyMs: 10,
			checks: [],
			details: {},
		});
		store.setRunning("image", true);

		const persisted = storedState();
		expect(persisted).not.toBeNull();
		expect(Object.keys(persisted as object).sort()).toEqual([
			"manualEndpoint",
			"selectedConnectionId",
		]);
	});
});
