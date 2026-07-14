import {
  ALL_CHECKS as CORE_CHECKS,
  type CheckDescriptor as CoreCheckDescriptor,
} from "@modeldoctor/insights-scoring";

// Web keeps a `recommendationKey` field on its check descriptors purely as a
// derived convenience (all 13 checks follow `checks.<checkId>.recommendation`
// — see buildFindings.ts, which actually resolves the i18n key straight from
// `checkId` rather than reading this field). The shared package's
// `CheckDescriptor` dropped `.read`/`recommendationKey` in favor of
// `metricKind` (resolved by an environment-specific `MetricReader`).
export interface CheckDescriptor extends CoreCheckDescriptor {
  recommendationKey: string;
}

export const ALL_CHECKS: CheckDescriptor[] = CORE_CHECKS.map((c) => ({
  ...c,
  recommendationKey: `checks.${c.id}.recommendation`,
}));

const byId = new Map(ALL_CHECKS.map((c) => [c.id, c]));

export function getCheck(id: string): CheckDescriptor | undefined {
  return byId.get(id);
}
