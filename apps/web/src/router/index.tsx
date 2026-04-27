import { LoginPage } from "@/features/auth/LoginPage";
import { ProtectedRoute } from "@/features/auth/ProtectedRoute";
import { RegisterPage } from "@/features/auth/RegisterPage";
import { BenchmarkDetailPage } from "@/features/benchmark/BenchmarkDetailPage";
import { BenchmarkListPage } from "@/features/benchmark/BenchmarkListPage";
import { ComingSoonPage } from "@/features/coming-soon/ComingSoonPage";
import { ConnectionsPage } from "@/features/connections/ConnectionsPage";
import { E2ESmokePage } from "@/features/e2e-smoke/E2ESmokePage";
import { ErrorPage } from "@/features/error/ErrorPage";
import { LoadTestPage } from "@/features/load-test/LoadTestPage";
import { NotFoundPage } from "@/features/not-found/NotFoundPage";
import { RequestDebugPage } from "@/features/request-debug/RequestDebugPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { AppShell } from "@/layouts/AppShell";
import {
  type Activity,
  GitCompare,
  HeartPulse,
  History as HistoryIcon,
  Timer,
  Zap,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Navigate, type RouteObject } from "react-router-dom";

function ComingSoonRoute({
  icon,
  itemKey,
}: {
  icon: typeof Activity;
  itemKey: string;
}) {
  const { t } = useTranslation("sidebar");
  return <ComingSoonPage icon={icon} title={t(`items.${itemKey}`)} />;
}

export const routes: RouteObject[] = [
  { path: "/login", element: <LoginPage />, errorElement: <ErrorPage /> },
  { path: "/register", element: <RegisterPage />, errorElement: <ErrorPage /> },
  {
    element: <ProtectedRoute />,
    errorElement: <ErrorPage />,
    children: [
      {
        path: "/",
        element: <AppShell />,
        errorElement: <ErrorPage />,
        children: [
          { index: true, element: <Navigate to="/load-test" replace /> },
          { path: "load-test", element: <LoadTestPage /> },
          { path: "benchmarks", element: <BenchmarkListPage /> },
          { path: "benchmarks/:id", element: <BenchmarkDetailPage /> },
          {
            path: "soak",
            element: <ComingSoonRoute icon={Timer} itemKey="soak" />,
          },
          {
            path: "streaming",
            element: <ComingSoonRoute icon={Zap} itemKey="streaming" />,
          },
          { path: "e2e", element: <E2ESmokePage /> },
          {
            path: "regression",
            element: <ComingSoonRoute icon={GitCompare} itemKey="regression" />,
          },
          {
            path: "health",
            element: <ComingSoonRoute icon={HeartPulse} itemKey="health" />,
          },
          {
            path: "history",
            element: <ComingSoonRoute icon={HistoryIcon} itemKey="history" />,
          },
          { path: "debug", element: <RequestDebugPage /> },
          { path: "connections", element: <ConnectionsPage /> },
          { path: "settings", element: <SettingsPage /> },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
];
