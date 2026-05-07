import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PALETTES, type Palette, type ThemeMode, useThemeStore } from "@/stores/theme-store";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";

const PALETTE_SWATCH_HSL: Record<Palette, string> = {
  slate: "240 5.9% 10%",
  aurora: "240 60% 60%",
  indigo: "244 100% 68%",
  plum: "263 84% 58%",
  clay: "21 90% 40%",
};

export function ThemeToggle() {
  const { t } = useTranslation("common");
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);
  const palette = useThemeStore((s) => s.palette);
  const setPalette = useThemeStore((s) => s.setPalette);

  const TriggerIcon = mode === "light" ? Sun : mode === "dark" ? Moon : Monitor;

  const modeItems: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
    { value: "light", label: t("theme.light"), icon: Sun },
    { value: "dark", label: t("theme.dark"), icon: Moon },
    { value: "system", label: t("theme.system"), icon: Monitor },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("theme.toggle")}>
          <TriggerIcon className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[12rem]">
        <DropdownMenuLabel className="text-xs uppercase tracking-wide text-muted-foreground">
          {t("theme.appearance")}
        </DropdownMenuLabel>
        {modeItems.map((item) => (
          <DropdownMenuItem key={item.value} onClick={() => setMode(item.value)} className="gap-2">
            <item.icon className="h-4 w-4" />
            <span>{item.label}</span>
            {mode === item.value ? (
              <span className="ml-auto text-xs text-muted-foreground">●</span>
            ) : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs uppercase tracking-wide text-muted-foreground">
          {t("theme.palette.title")}
        </DropdownMenuLabel>
        {PALETTES.map((p) => (
          <DropdownMenuItem key={p} onClick={() => setPalette(p)} className="gap-2">
            <span
              aria-hidden="true"
              className="h-3 w-3 rounded-full border border-border"
              style={{ backgroundColor: `hsl(${PALETTE_SWATCH_HSL[p]})` }}
            />
            <span>{t(`theme.palette.${p}`)}</span>
            {palette === p ? (
              <span className="ml-auto text-xs text-muted-foreground">●</span>
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
