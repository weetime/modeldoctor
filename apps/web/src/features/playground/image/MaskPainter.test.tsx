import i18n from "@/lib/i18n";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import { MaskPainter } from "./MaskPainter";

const renderPainter = (props: Partial<React.ComponentProps<typeof MaskPainter>> = {}) =>
  render(
    <I18nextProvider i18n={i18n}>
      <MaskPainter
        imageUrl="blob:fake"
        width={100}
        height={100}
        brushSize={20}
        onMaskChange={vi.fn()}
        {...props}
      />
    </I18nextProvider>,
  );

describe("MaskPainter", () => {
  it("renders brush slider with the given value", () => {
    renderPainter({ brushSize: 30, onBrushSizeChange: vi.fn() });
    const slider = screen.getByRole("slider", { name: /brush size|画笔/i });
    expect(slider).toHaveValue("30");
  });

  it("Reset clears the mask and emits null via onMaskChange", async () => {
    const onMaskChange = vi.fn();
    renderPainter({ onMaskChange });
    onMaskChange.mockClear(); // ignore the initial mount-time emission
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /reset|清除/i }));
    expect(onMaskChange).toHaveBeenCalledWith(null);
  });

  it("calls onBrushSizeChange when the slider moves", () => {
    const onBrushSizeChange = vi.fn();
    renderPainter({ onBrushSizeChange });
    const slider = screen.getByRole("slider", { name: /brush size|画笔/i });
    fireEvent.change(slider, { target: { value: "60" } });
    expect(onBrushSizeChange).toHaveBeenCalled();
    const [arg] = onBrushSizeChange.mock.calls.at(-1) ?? [];
    expect(arg).toBe(60);
  });

  it("renders both base and overlay canvases", () => {
    const { container } = renderPainter();
    const canvases = container.querySelectorAll("canvas");
    expect(canvases.length).toBe(2);
  });

  it("Undo button exists and is harmless when no stroke has been made", async () => {
    const onMaskChange = vi.fn();
    renderPainter({ onMaskChange });
    const user = userEvent.setup();
    // Should not crash; with no undoBuf, it's a no-op.
    await user.click(screen.getByRole("button", { name: /undo|撤销/i }));
  });
});
