import {
  sidebarGroups,
  sidebarPrimaryItems,
  sidebarUtilityItems,
} from "@/components/sidebar/sidebar-config";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { type ThemeMode, useThemeStore } from "@/stores/theme-store";
import { Keyboard, Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

interface CommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onShowHelp: () => void;
}

/**
 * App-level command palette. Triggered globally by ⌘K / Ctrl+K and
 * Esc-to-dismiss; Enter on a row runs the action and closes the menu.
 */
export function CommandMenu({ open, onOpenChange, onShowHelp }: CommandMenuProps) {
  const { t } = useTranslation("commands");
  const { t: ts } = useTranslation("sidebar");
  const navigate = useNavigate();
  const setMode = useThemeStore((s) => s.setMode);

  const close = () => onOpenChange(false);

  const go = (to: string) => () => {
    navigate(to);
    close();
  };

  const setTheme = (m: ThemeMode) => () => {
    setMode(m);
    close();
  };

  const navItems = [
    ...sidebarPrimaryItems,
    ...sidebarGroups.flatMap((g) => g.items),
    ...sidebarUtilityItems,
  ].filter((i) => !i.devOnly || import.meta.env.DEV);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      label={t("label")}
      description={t("description")}
    >
      <CommandInput placeholder={t("placeholder")} />
      <CommandList>
        <CommandEmpty>{t("empty")}</CommandEmpty>

        <CommandGroup heading={t("group.navigate")}>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <CommandItem
                key={item.to}
                value={`${ts(item.labelKey)} ${item.to}`}
                onSelect={go(item.to)}
              >
                <Icon className="text-muted-foreground" strokeWidth={1.5} />
                <span>{ts(item.labelKey)}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading={t("group.theme")}>
          <CommandItem value={`${t("theme.light")} theme light`} onSelect={setTheme("light")}>
            <Sun className="text-muted-foreground" strokeWidth={1.5} />
            <span>{t("theme.light")}</span>
          </CommandItem>
          <CommandItem value={`${t("theme.dark")} theme dark`} onSelect={setTheme("dark")}>
            <Moon className="text-muted-foreground" strokeWidth={1.5} />
            <span>{t("theme.dark")}</span>
          </CommandItem>
          <CommandItem value={`${t("theme.system")} theme system`} onSelect={setTheme("system")}>
            <Monitor className="text-muted-foreground" strokeWidth={1.5} />
            <span>{t("theme.system")}</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading={t("group.help")}>
          <CommandItem
            value={`${t("help.shortcuts")} keyboard shortcuts help ?`}
            onSelect={() => {
              close();
              onShowHelp();
            }}
          >
            <Keyboard className="text-muted-foreground" strokeWidth={1.5} />
            <span>{t("help.shortcuts")}</span>
            <CommandShortcut>?</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
