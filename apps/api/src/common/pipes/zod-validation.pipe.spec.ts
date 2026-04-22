import { describe, it, expect } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
import { ZodValidationPipe } from "./zod-validation.pipe.js";

describe("ZodValidationPipe", () => {
  const schema = z.object({ name: z.string(), age: z.number().int() });
  const meta = { type: "body" as const };

  it("returns parsed data when input is valid", () => {
    const pipe = new ZodValidationPipe(schema);
    const out = pipe.transform({ name: "x", age: 1 }, meta);
    expect(out).toEqual({ name: "x", age: 1 });
  });

  it("throws BadRequestException on first validation failure", () => {
    const pipe = new ZodValidationPipe(schema);
    expect(() => pipe.transform({ name: 123 }, meta)).toThrow(BadRequestException);
  });

  it("includes field path and message in the thrown error", () => {
    const pipe = new ZodValidationPipe(schema);
    try {
      pipe.transform({ name: 123 }, meta);
    } catch (e) {
      expect((e as BadRequestException).message).toMatch(/name/);
    }
  });
});
