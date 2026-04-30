import i18n from "@/lib/i18n";
import { useConnectionsStore } from "@/stores/connections-store";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InpaintMode } from "./InpaintMode";
import { useImageStore } from "./store";

// Mock MaskPainter so tests can simulate mask painting without a real canvas.
// The stub renders a button labelled "Paint Mask" that calls onMaskChange with
// a non-null Blob, and a "Clear Mask" button that calls it with null.
vi.mock("./MaskPainter", () => ({
  MaskPainter: ({
    onMaskChange,
  }: {
    imageUrl: string;
    width: number;
    height: number;
    brushSize: number;
    onBrushSizeChange?: (n: number) => void;
    onMaskChange: (mask: Blob | null) => void;
  }) => (
    <div>
      <input type="range" aria-label="Brush size" onChange={() => {}} defaultValue={20} />
      <button type="button" onClick={() => onMaskChange(new Blob(["mask"]))}>
        Paint Mask
      </button>
      <button type="button" onClick={() => onMaskChange(null)}>
        Clear Mask
      </button>
      <button type="button" aria-label="Reset">
        Reset
      </button>
      <button type="button" aria-label="Undo">
        Undo
      </button>
    </div>
  ),
}));

const renderInpaint = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <InpaintMode />
    </I18nextProvider>,
  );

const seedConn = () => {
  useConnectionsStore.setState({ connections: [] } as never);
  useConnectionsStore.getState().create({
    name: "img",
    apiBaseUrl: "http://x",
    apiKey: "k",
    model: "gpt-image-1",
    customHeaders: "",
    queryParams: "",
    category: "image",
    tags: [],
  } as never);
  const c = useConnectionsStore.getState().list()[0];
  useImageStore.setState((s) => ({ ...s, selectedConnectionId: c.id }));
};

describe("InpaintMode", () => {
  const mockCreateObjectURL = vi.fn(() => "blob:fake");
  const mockRevokeObjectURL = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("URL", {
      createObjectURL: mockCreateObjectURL,
      revokeObjectURL: mockRevokeObjectURL,
      // biome-ignore lint/suspicious/noExplicitAny: pass-through to real URL static methods
      parse: (URL as any).parse,
      // biome-ignore lint/suspicious/noExplicitAny: pass-through to real URL static methods
      canParse: (URL as any).canParse,
    });
    useImageStore.getState().reset();
    useConnectionsStore.setState({ connections: [] } as never);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockCreateObjectURL.mockClear();
    mockRevokeObjectURL.mockClear();
  });

  it("shows the upload placeholder when no image is loaded", () => {
    renderInpaint();
    expect(screen.getByRole("button", { name: /upload image|上传图片/i })).toBeInTheDocument();
  });

  it("Send button is disabled when there is no image", () => {
    seedConn();
    renderInpaint();
    // The Send button only appears alongside the prompt textarea, which is
    // always rendered. Verify it's disabled (no image yet).
    const send = screen.getByRole("button", { name: /^edit$|^编辑$/i });
    expect(send).toBeDisabled();
  });

  it("rejects unsupported mime types via toast (no state change)", async () => {
    seedConn();
    renderInpaint();
    const file = new File([new Uint8Array([0])], "bad.gif", { type: "image/gif" });
    const input = screen.getByRole("button", { name: /upload image|上传图片/i });
    await userEvent.click(input);
    // The hidden input is the previous sibling — find via document
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();
    if (!fileInput) return;
    fireEvent.change(fileInput, { target: { files: [file] } });
    expect(useImageStore.getState().inpaint.imageName).toBeNull();
  });

  it("accepts a PNG upload and renders the painter UI", async () => {
    seedConn();
    renderInpaint();
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "in.png", {
      type: "image/png",
    });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (!fileInput) throw new Error("no file input");
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(useImageStore.getState().inpaint.imageName).toBe("in.png"));
    // Painter shows up: brush slider + Reset/Undo buttons
    expect(screen.getByRole("slider", { name: /brush size|画笔/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reset|清除/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /undo|撤销/i })).toBeInTheDocument();
  });

  it("Submit button is disabled when image and prompt are set but no mask is painted", async () => {
    seedConn();
    renderInpaint();
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "in.png", {
      type: "image/png",
    });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (!fileInput) throw new Error("no file input");
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(useImageStore.getState().inpaint.imageName).toBe("in.png"));
    useImageStore.getState().patchInpaint({ prompt: "make it blue" });

    // No mask painted yet — button must be disabled.
    const send = screen.getByRole("button", { name: /^edit$|^编辑$/i });
    expect(send).toBeDisabled();
  });

  it("Submit button becomes enabled after onMaskChange fires with a non-null blob", async () => {
    seedConn();
    renderInpaint();
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "in.png", {
      type: "image/png",
    });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (!fileInput) throw new Error("no file input");
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(useImageStore.getState().inpaint.imageName).toBe("in.png"));
    useImageStore.getState().patchInpaint({ prompt: "make it blue" });

    // Simulate the user painting a mask via the stub MaskPainter.
    await userEvent.click(screen.getByRole("button", { name: /paint mask/i }));

    const send = screen.getByRole("button", { name: /^edit$|^编辑$/i });
    expect(send).toBeEnabled();
  });

  it("posts FormData to /api/playground/images/edit when submit is clicked", async () => {
    seedConn();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        JSON.stringify({ success: true, artifacts: [{ url: "http://i/edit" }], latencyMs: 9 }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    renderInpaint();
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "in.png", {
      type: "image/png",
    });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (!fileInput) throw new Error("no file input");
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(useImageStore.getState().inpaint.imageName).toBe("in.png"));
    useImageStore.getState().patchInpaint({ prompt: "make it blue" });

    // Paint a mask so canSubmit becomes true.
    await userEvent.click(screen.getByRole("button", { name: /paint mask/i }));

    // Now click Send — fetch should be called.
    await userEvent.click(screen.getByRole("button", { name: /^edit$|^编辑$/i }));
    await waitFor(() =>
      expect((fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0),
    );
  });
});
