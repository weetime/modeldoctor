import { ApiTypeSchema, type LoadTestResponse } from "@modeldoctor/contracts";

export type {
  ApiType,
  LoadTestParsed,
  LoadTestResponse,
} from "@modeldoctor/contracts";

/** Runtime list of supported API types (mirrors `ApiTypeSchema.options`). */
export const API_TYPES = ApiTypeSchema.options;

/** FE-only aggregate: the success-branch payload without the discriminator. */
export type LoadTestResult = Omit<LoadTestResponse, "success">;
