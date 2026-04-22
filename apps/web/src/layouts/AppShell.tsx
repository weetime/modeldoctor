import { Sidebar } from "@/components/sidebar/Sidebar";
import { Outlet } from "react-router-dom";

export function AppShell() {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar />
      <main className="flex-1 min-w-0 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
