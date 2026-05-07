import { CommandMenuProvider } from "@/components/command-menu/CommandMenuProvider";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { Outlet } from "react-router-dom";

export function AppShell() {
  return (
    <div className="flex h-screen bg-background text-foreground">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
      <CommandMenuProvider />
    </div>
  );
}
