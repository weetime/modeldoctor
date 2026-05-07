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
import { SettingRow, SettingSection } from "./settings-primitives";

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
      {/* Settings is the one page that opts out of the full-width body rule:
          industry-standard settings (Vercel/Stripe/Linear/Anthropic) center a
          narrow column for readability. */}
      <div className="mx-auto max-w-3xl px-8 py-6">
        <div className="divide-y divide-border">
          <SettingSection title={t("appearance.title")} description={t("appearance.description")}>
            <SettingRow
              label={t("appearance.theme")}
              control={
                <RadioGroup
                  value={theme}
                  onValueChange={(v) => setTheme(v as ThemeMode)}
                  className="flex flex-wrap gap-4"
                >
                  {(["light", "dark", "system"] as ThemeMode[]).map((m) => (
                    <div key={m} className="flex items-center gap-2">
                      <RadioGroupItem id={`th-${m}`} value={m} />
                      <Label htmlFor={`th-${m}`} className="text-sm">
                        {t(`appearance.themeOptions.${m}`)}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              }
            />
            <SettingRow
              label={t("appearance.palette")}
              description={t("appearance.paletteHint")}
              control={
                <RadioGroup
                  value={palette}
                  onValueChange={(v) => setPalette(v as Palette)}
                  className="flex flex-wrap gap-4"
                >
                  {PALETTES.map((p) => (
                    <div key={p} className="flex items-center gap-2">
                      <RadioGroupItem id={`pal-${p}`} value={p} />
                      <Label
                        htmlFor={`pal-${p}`}
                        className="flex items-center gap-2 text-sm capitalize"
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
              }
            />
            <SettingRow
              label={t("appearance.language")}
              control={
                <Select value={locale} onValueChange={(v) => setLocale(v as Locale)}>
                  <SelectTrigger className="max-w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en-US">{t("appearance.languages.en")}</SelectItem>
                    <SelectItem value="zh-CN">{t("appearance.languages.zh")}</SelectItem>
                  </SelectContent>
                </Select>
              }
            />
          </SettingSection>

          <SettingSection title={t("ai.title")} description={t("ai.description")}>
            <AiDiagnosisSection />
          </SettingSection>

          <SettingSection title={t("environment.title")} description={t("environment.description")}>
            <SettingRow
              label={t("environment.buildMode")}
              control={
                <code className="rounded bg-muted px-2 py-1 font-mono text-sm">
                  {import.meta.env.MODE}
                </code>
              }
            />
          </SettingSection>

          <SettingSection title={t("data.title")} description={t("data.description")} destructive>
            <SettingRow
              label={t("data.clearTestData")}
              description={t("data.clearTestDataDesc")}
              control={
                <Button variant="outline" size="sm" onClick={() => setClearOpen(true)}>
                  {t("data.clearTestData")}
                </Button>
              }
            />
            <SettingRow
              label={t("data.resetState")}
              description={t("data.resetStateDesc")}
              control={
                <Button variant="destructive" size="sm" onClick={() => setResetOpen(true)}>
                  {t("data.resetState")}
                </Button>
              }
            />
          </SettingSection>
        </div>
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
