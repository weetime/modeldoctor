import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ConfirmDeleteDialog } from "@/components/common/confirm-delete-dialog";
import { PageHeader } from "@/components/common/page-header";
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
import { type ThemeMode, useThemeStore } from "@/stores/theme-store";
import { AiDiagnosisSection } from "./AiDiagnosisSection";
import { DangerZoneCard, DangerZoneRow, SettingRow, SettingSection } from "./settings-primitives";

export function SettingsPage() {
  const { t } = useTranslation("settings");
  const { t: tPromDs } = useTranslation("prometheus-datasources");
  const theme = useThemeStore((s) => s.mode);
  const setTheme = useThemeStore((s) => s.setMode);
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
      <div className="px-8 py-6">
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

          <SettingSection title={tPromDs("settings.title")} description={tPromDs("settings.desc")}>
            <SettingRow
              label={tPromDs("settings.title")}
              control={
                <Button variant="outline" size="sm" asChild>
                  <Link to="/settings/prometheus-datasources">{tPromDs("settings.manage")} →</Link>
                </Button>
              }
            />
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
            <DangerZoneCard>
              <DangerZoneRow
                title={t("data.clearTestData")}
                description={t("data.clearTestDataDesc")}
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setClearOpen(true)}
                    className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    {t("data.clearTestData")}
                  </Button>
                }
              />
              <DangerZoneRow
                title={t("data.resetState")}
                description={t("data.resetStateDesc")}
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setResetOpen(true)}
                    className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    {t("data.resetState")}
                  </Button>
                }
              />
            </DangerZoneCard>
          </SettingSection>
        </div>
      </div>

      <ConfirmDeleteDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title={t("data.clearTestData")}
        description={t("data.clearTestDataWarning")}
        confirmLabel={t("data.clearTestDataConfirm")}
        onConfirm={onClearTestData}
      />
      <ConfirmDeleteDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title={t("data.resetState")}
        description={t("data.resetWarning")}
        confirmLabel={t("data.resetConfirm")}
        onConfirm={onResetAll}
      />
    </>
  );
}
