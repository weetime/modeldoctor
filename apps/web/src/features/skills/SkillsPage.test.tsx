import "@/lib/i18n";
import type { SkillPublic } from "@modeldoctor/contracts";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const seedList: SkillPublic[] = [
  {
    id: "s1",
    userId: "u1",
    name: "diagnose-vllm",
    description: "Diagnose a vLLM deployment via metrics + logs",
    systemPrompt: "You are an SRE assistant.",
    modelConnectionId: undefined,
    mcpServerIds: [],
    inlineTools: null,
    planFirst: true,
    maxSteps: 12,
    createdAt: "2026-07-05T00:00:00Z",
    updatedAt: "2026-07-05T00:00:00Z",
  },
];

const deleteMutate = vi.fn();

vi.mock("./queries", () => ({
  useSkills: () => ({ data: seedList, isLoading: false, error: null }),
  useDeleteSkill: () => ({ mutate: deleteMutate, isPending: false }),
  // SkillSheet imports these — stub so it renders if the sheet ever opens.
  useCreateSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { SkillsPage } from "./SkillsPage";

describe("SkillsPage", () => {
  beforeEach(() => {
    deleteMutate.mockClear();
  });

  it("renders name, description and the create button", () => {
    render(
      <MemoryRouter>
        <SkillsPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("diagnose-vllm")).toBeInTheDocument();
    expect(screen.getByText("Diagnose a vLLM deployment via metrics + logs")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /New skill|新建 Skill/i })).toBeInTheDocument();
  });

  it("delete flow: opens the confirm dialog and calls delete after typing DELETE", async () => {
    render(
      <MemoryRouter>
        <SkillsPage />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: /actions|操作/i }));
    await userEvent.click(await screen.findByText(/^Delete$|^删除$/));

    const dialog = await screen.findByRole("alertdialog");
    await userEvent.type(within(dialog).getByRole("textbox"), "DELETE");
    const confirmBtn = within(dialog).getByRole("button", { name: /^Delete$|^删除$/ });
    expect(confirmBtn).not.toBeDisabled();
    await userEvent.click(confirmBtn);

    expect(deleteMutate).toHaveBeenCalledWith("s1", expect.anything());
  });
});
