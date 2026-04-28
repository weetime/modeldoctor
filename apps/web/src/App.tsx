import { TooltipProvider } from "@/components/ui/tooltip";
import { startAccessTokenScheduler } from "@/lib/access-token-scheduler";
import { refreshAccessToken } from "@/lib/api-client";
import { routes } from "@/router";
import { useThemeStore } from "@/stores/theme-store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";

const router = createBrowserRouter(routes);
const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

export default function App() {
  const themeMode = useThemeStore((s) => s.mode);
  useEffect(() => {
    return startAccessTokenScheduler(refreshAccessToken);
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={150}>
        <RouterProvider router={router} />
        <Toaster position="bottom-right" richColors closeButton theme={themeMode} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
