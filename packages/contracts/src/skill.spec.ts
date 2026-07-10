import { describe, expect, it } from "vitest";
import { createSkillSchema, skillSchema, updateSkillSchema } from "./skill.js";

describe("skill contracts", () => {
  describe("createSkillSchema", () => {
    it("requires only name; defaults mcpServerIds/planFirst/maxSteps", () => {
      const v = createSkillSchema.parse({ name: "researcher" });
      expect(v.mcpServerIds).toEqual([]);
      expect(v.planFirst).toBe(false);
      expect(v.maxSteps).toBe(12);
    });

    it("rejects empty name", () => {
      expect(() => createSkillSchema.parse({ name: "" })).toThrow();
    });

    it("accepts a full payload with mcpServerIds + inlineTools", () => {
      const v = createSkillSchema.parse({
        name: "researcher",
        description: "does research",
        systemPrompt: "You are a careful researcher.",
        modelConnectionId: "conn_1",
        mcpServerIds: ["mcp_1", "mcp_2"],
        inlineTools: [
          {
            type: "function",
            function: { name: "search", parameters: { type: "object", properties: {} } },
          },
        ],
        planFirst: true,
        maxSteps: 20,
      });
      expect(v.mcpServerIds).toEqual(["mcp_1", "mcp_2"]);
      expect(v.inlineTools).toHaveLength(1);
      expect(v.planFirst).toBe(true);
    });

    it("accepts inlineTools: null explicitly", () => {
      const v = createSkillSchema.parse({ name: "x", inlineTools: null });
      expect(v.inlineTools).toBeNull();
    });

    describe("maxSteps bounds", () => {
      it("rejects maxSteps below 1", () => {
        expect(() => createSkillSchema.parse({ name: "x", maxSteps: 0 })).toThrow();
      });
      it("rejects maxSteps above 50", () => {
        expect(() => createSkillSchema.parse({ name: "x", maxSteps: 51 })).toThrow();
      });
      it("rejects non-integer maxSteps", () => {
        expect(() => createSkillSchema.parse({ name: "x", maxSteps: 1.5 })).toThrow();
      });
      it("accepts boundary values 1 and 50", () => {
        expect(createSkillSchema.parse({ name: "x", maxSteps: 1 }).maxSteps).toBe(1);
        expect(createSkillSchema.parse({ name: "x", maxSteps: 50 }).maxSteps).toBe(50);
      });
    });

    it("rejects a malformed inline tool (missing function.parameters)", () => {
      expect(() =>
        createSkillSchema.parse({
          name: "x",
          inlineTools: [{ type: "function", function: { name: "search" } }],
        }),
      ).toThrow();
    });
  });

  describe("updateSkillSchema", () => {
    it("allows a partial patch", () => {
      const v = updateSkillSchema.parse({ maxSteps: 30 });
      expect(v.maxSteps).toBe(30);
      expect(v.name).toBeUndefined();
    });

    it("allows an empty patch", () => {
      expect(updateSkillSchema.parse({})).toEqual({});
    });
  });

  describe("skillSchema (public)", () => {
    const base = {
      id: "sk_1",
      name: "researcher",
      mcpServerIds: [],
      planFirst: false,
      maxSteps: 12,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    it("parses a fresh row with inlineTools: null (unset nullable Prisma column)", () => {
      const p = skillSchema.parse({ ...base, inlineTools: null });
      expect(p.inlineTools).toBeNull();
    });

    it("parses a row that omits inlineTools entirely", () => {
      const p = skillSchema.parse(base);
      expect(p.inlineTools).toBeUndefined();
    });

    it("omits userId from anonymized/public reads (optional)", () => {
      const p = skillSchema.parse(base);
      expect(p.userId).toBeUndefined();
    });
  });
});
