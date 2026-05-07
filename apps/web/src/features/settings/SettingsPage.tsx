import { PageHeader } from "@/components/common/page-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useE2EStore } from "@/features/diagnostics/store";
import { useDebugStore } from "@/features/request-debug/store";
import { type Locale, useLocaleStore } from "@/stores/locale-store";
import { useSidebarStore } from "@/stores/sidebar-store";
import { PALETTES, type Palette, type ThemeMode, useThemeStore } from "@/stores/theme-store";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AiDiagnosisSection } from "./AiDiagnosisSection";

const PALETTE_SWATCH_HSL: Record<Palette, string> = {
  slate: "240 5.9% 10%",
  aurora: "240 60% 60%",
  indigo: "244 100% 68%",
  plum: "263 84% 58%",
  clay: "21 90% 40%",
};

export function SettingsPage() {
  const { t } = useTranslation("settings");
  const { t: tc } = useTranslation("common");
  const theme = useThemeStore((s) => s.mode);
  const setTheme = useThemeStore((s) => s.setMode);
  const palette = useThemeStore((s) => s.palette);
  const setPalette = useThemeStore((s) => s.setPalette);
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  const resetE2E = useE2EStore((s) => s.reset);
  const resetDebug = useDebugStore((s) => s.reset);
  const resetTheme = useThemeStore((s) => s.reset);
  const resetLocale = useLocaleStore((s) => s.reset);
  const resetSidebar = useSidebarStore((s) => s.reset);
  const [resetOpen, setResetOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);

  const onClearTestData = () => {
    resetE2E();
    resetDebug();
    setClearOpen(false);
    toast.success(t("data.clearTestDataSuccess"));
  };

  const onResetAll = () => {
    // Call every persistent store's reset() so localStorage holds the new
    // INITIAL state for each. Reload gives a fresh React tree and resets
    // route + any non-store component-local state.
    resetE2E();
    resetDebug();
    resetTheme();
    resetLocale();
    resetSidebar();
    window.location.reload();
  };

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="space-y-6 px-8 py-6">
        <Section title={t("appearance.title")}>
          <div className="space-y-4">
            <div>
              <Label>{t("appearance.theme")}</Label>
              <RadioGroup
                value={theme}
                onValueChange={(v) => setTheme(v as ThemeMode)}
                className="mt-2 flex gap-4"
              >
                {(["light", "dark", "system"] as ThemeMode[]).map((m) => (
                  <div key={m} className="flex items-center gap-2">
                    <RadioGroupItem id={`th-${m}`} value={m} />
                    <Label htmlFor={`th-${m}`} className="font-normal">
                      {t(`appearance.themeOptions.${m}`)}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
            <div>
              <Label>{t("appearance.palette")}</Label>
              <p className="mt-1 text-xs text-muted-foreground">{t("appearance.paletteHint")}</p>
              <RadioGroup
                value={palette}
                onValueChange={(v) => setPalette(v as Palette)}
                className="mt-2 flex flex-wrap gap-4"
              >
                {PALETTES.map((p) => (
                  <div key={p} className="flex items-center gap-2">
                    <RadioGroupItem id={`pal-${p}`} value={p} />
                    <Label
                      htmlFor={`pal-${p}`}
                      className="flex items-center gap-2 font-normal capitalize"
                    >
                      <span
                        aria-hidden="true"
                        className="h-3 w-3 rounded-full border border-border"
                        style={{ backgroundColor: `hsl(${PALETTE_SWATCH_HSL[p]})` }}
                      />
                      {p}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
            <div>
              <Label>{t("appearance.language")}</Label>
              <Select value={locale} onValueChange={(v) => setLocale(v as Locale)}>
                <SelectTrigger className="mt-2 max-w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en-US">{t("appearance.languages.en")}</SelectItem>
                  <SelectItem value="zh-CN">{t("appearance.languages.zh")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </Section>

        <Section title={t("environment.title")}>
          <div className="text-sm text-muted-foreground">
            {t("environment.buildMode")}: <span className="font-mono">{import.meta.env.MODE}</span>
          </div>
        </Section>

        <AiDiagnosisSection />

        <Section title={t("data.title")}>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setClearOpen(true)}>
              {t("data.clearTestData")}
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setResetOpen(true)}>
              {t("data.resetState")}
            </Button>
          </div>
        </Section>
      </div>

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("data.clearTestData")}</AlertDialogTitle>
            <AlertDialogDescription>{t("data.clearTestDataWarning")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={onClearTestData}>
              {t("data.clearTestDataConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("data.resetState")}</AlertDialogTitle>
            <AlertDialogDescription>{t("data.resetWarning")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={onResetAll}>{t("data.resetConfirm")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}
