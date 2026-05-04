import { LoginPage } from "@/features/auth/LoginPage";
import { ProtectedRoute } from "@/features/auth/ProtectedRoute";
import { RegisterPage } from "@/features/auth/RegisterPage";
import { ConnectionsPage } from "@/features/connections/ConnectionsPage";
import { DevChartsPage } from "@/features/dev-charts";
import { BenchmarkCreatePage } from "@/features/benchmarks/BenchmarkCreatePage";
import { BenchmarkDetailPage } from "@/features/benchmarks/BenchmarkDetailPage";
import { BenchmarkListShell } from "@/features/benchmarks/BenchmarkListShell";
import { BenchmarkComparePage } from "@/features/benchmarks/compare/BenchmarkComparePage";
import { DiagnosticsPage } from "@/features/diagnostics/DiagnosticsPage";
import { ErrorPage } from "@/features/error/ErrorPage";
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
import { Navigate, type RouteObject } from "react-router-dom";

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
          { index: true, element: <Navigate to="/runs" replace /> },
          { path: "e2e", element: <DiagnosticsPage /> },
          {
            path: "runs",
            element: <BenchmarkListShell />,
          },
          { path: "runs/new", element: <BenchmarkCreatePage /> },
          { path: "runs/compare", element: <BenchmarkComparePage /> },
          {
            path: "runs/:id",
            element: <BenchmarkDetailPage />,
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
          { path: "dev/charts", element: <DevChartsPage /> },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
];
