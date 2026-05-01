import { LoginPage } from "@/features/auth/LoginPage";
import { ProtectedRoute } from "@/features/auth/ProtectedRoute";
import { RegisterPage } from "@/features/auth/RegisterPage";
import { BenchmarkDetailPage } from "@/features/benchmark/BenchmarkDetailPage";
import { BenchmarkListPage } from "@/features/benchmark/BenchmarkListPage";
import { ComingSoonPage } from "@/features/coming-soon/ComingSoonPage";
import { ConnectionsPage } from "@/features/connections/ConnectionsPage";
import { DevChartsPage } from "@/features/dev-charts";
import { E2ESmokePage } from "@/features/e2e-smoke/E2ESmokePage";
import { ErrorPage } from "@/features/error/ErrorPage";
import { HistoryDetailPage } from "@/features/history/HistoryDetailPage";
import { HistoryListPage } from "@/features/history/HistoryListPage";
import { LoadTestPage } from "@/features/load-test/LoadTestPage";
import { NotFoundPage } from "@/features/not-found/NotFoundPage";
import { AudioPage } from "@/features/playground/audio/AudioPage";
import { ChatComparePage } from "@/features/playground/chat-compare/ChatComparePage";
import { ChatPage } from "@/features/playground/chat/ChatPage";
import { EmbeddingsPage } from "@/features/playground/embeddings/EmbeddingsPage";
import { ImagePage } from "@/features/playground/image/ImagePage";
import { RerankPage } from "@/features/playground/rerank/RerankPage";
import { RequestDebugPage } from "@/features/request-debug/RequestDebugPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { AppShell } from "@/layouts/AppShell";
import {
  type Activity,
  GitCompare,
  HeartPulse,
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
            element: <HistoryListPage />,
          },
          {
            path: "history/:runId",
            element: <HistoryDetailPage />,
          },
          { path: "debug", element: <RequestDebugPage /> },
          { path: "connections", element: <ConnectionsPage /> },
          { path: "settings", element: <SettingsPage /> },
          { path: "playground", element: <Navigate to="/playground/chat" replace /> },
          { path: "playground/chat", element: <ChatPage /> },
          { path: "playground/chat/compare", element: <ChatComparePage /> },
          { path: "playground/image", element: <ImagePage /> },
          { path: "playground/audio", element: <AudioPage /> },
          { path: "playground/embeddings", element: <EmbeddingsPage /> },
          { path: "playground/rerank", element: <RerankPage /> },
          // Dev-only chart QA page; remove in #51 sidebar reorganize.
          { path: "dev/charts", element: <DevChartsPage /> },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
];
