import { z } from "zod";
import { endpointReportRangeSchema } from "../benchmark.js";
import { ModalityCategorySchema } from "../modality.js";

export const matrixAggregateSchema = z.enum(["scenario", "tool", "engine"]);
export type MatrixAggregate = z.infer<typeof matrixAggregateSchema>;

export const matrixBandSchema = z.enum(["recommended", "usable", "not-recommended"]);
export type MatrixBand = z.infer<typeof matrixBandSchema>;

export const matrixDimensionSchema = z.object({
  key: z.string(),
  label: z.string(),
  count: z.number().int(),
});
export type MatrixDimension = z.infer<typeof matrixDimensionSchema>;

export const matrixEndpointSchema = z.object({
  id: z.string(),
  name: z.string(),
  model: z.string(),
  baseUrl: z.string(),
  category: ModalityCategorySchema,
  serverKind: z.string().nullable(),
});
export type MatrixEndpoint = z.infer<typeof matrixEndpointSchema>;

export const matrixCellSchema = z.object({
  endpointId: z.string(),
  dimKey: z.string(),
  runs: z.number().int(),
  score: z.number().nullable(),
  band: matrixBandSchema.nullable(),
  nativeMetric: z
    .object({
      kind: z.string(),
      value: z.number(),
      unit: z.string(),
    })
    .nullable(),
});
export type MatrixCell = z.infer<typeof matrixCellSchema>;

export const insightsMatrixResponseSchema = z.object({
  aggregate: matrixAggregateSchema,
  range: endpointReportRangeSchema,
  generatedAt: z.string().datetime(),
  dimensions: z.array(matrixDimensionSchema),
  endpoints: z.array(matrixEndpointSchema),
  cells: z.array(matrixCellSchema),
});
export type InsightsMatrixResponse = z.infer<typeof insightsMatrixResponseSchema>;
