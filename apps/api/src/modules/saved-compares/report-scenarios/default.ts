import type { ReportScenarioProfile } from "./types.js";

export const defaultProfile: ReportScenarioProfile = {
  intent: "default",
  promptFragment: () => "",
  dataAssembly: () => ({ promptBlock: "", preferredFigures: [] }),
};
