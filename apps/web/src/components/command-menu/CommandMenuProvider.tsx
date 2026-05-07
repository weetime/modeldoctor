import { useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { CommandMenu } from "./CommandMenu";
import { ShortcutCheatsheet } from "./ShortcutCheatsheet";

/**
 * Mounts the global command palette (⌘K / Ctrl+K) and shortcut cheatsheet (?)
 * exactly once at the app shell, so they're available from any route.
 */
export function CommandMenuProvider() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // ⌘K / Ctrl+K: toggle the palette. `enableOnFormTags` so it works while a
  // form input is focused — that's where users want quick navigation most.
  useHotkeys(
    ["meta+k", "ctrl+k"],
    (event) => {
      event.preventDefault();
      setPaletteOpen((v) => !v);
    },
    { enableOnFormTags: true, enableOnContentEditable: true, preventDefault: true },
  );

  // `?` opens the cheatsheet — only when no form field has focus, so we don't
  // hijack legitimate `?` keystrokes inside text inputs. Bind both forms:
  // `?` matches by KeyboardEvent.key on layouts where the OS resolves the
  // character, and `shift+/` is the explicit US-layout combo as a fallback.
  useHotkeys(["?", "shift+/"], (event) => {
    event.preventDefault();
    setHelpOpen(true);
  });

  return (
    <>
      <CommandMenu
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onShowHelp={() => setHelpOpen(true)}
      />
      <ShortcutCheatsheet open={helpOpen} onOpenChange={setHelpOpen} />
    </>
  );
}
