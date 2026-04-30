import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { AudioPage } from "./AudioPage";

vi.mock("./TtsTab", () => ({ TtsTab: () => <div data-testid="tts-tab" /> }));
vi.mock("./SttTab", () => ({ SttTab: () => <div data-testid="stt-tab" /> }));

const renderAt = (initialEntry: string) =>
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/playground/audio" element={<AudioPage />} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );

describe("AudioPage", () => {
  it("defaults to TTS tab when no ?tab=", () => {
    renderAt("/playground/audio");
    expect(screen.getByTestId("tts-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("stt-tab")).not.toBeInTheDocument();
  });

  it("renders STT tab when ?tab=stt", () => {
    renderAt("/playground/audio?tab=stt");
    expect(screen.getByTestId("stt-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("tts-tab")).not.toBeInTheDocument();
  });
});
