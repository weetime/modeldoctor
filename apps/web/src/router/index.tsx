import { LoginPage } from "@/features/auth/LoginPage";
import { ProtectedRoute } from "@/features/auth/ProtectedRoute";
import { RegisterPage } from "@/features/auth/RegisterPage";
import { ConnectionsPage } from "@/features/connections/ConnectionsPage";
import { DevChartsPage } from "@/features/dev-charts";
import { E2ESmokePage } from "@/features/e2e-smoke/E2ESmokePage";
import { ErrorPage } from "@/features/error/ErrorPage";
import { NotFoundPage } from "@/features/not-found/NotFoundPage";
import { AudioPage } from "@/features/playground/audio/AudioPage";
import { ChatComparePage } from "@/features/playground/chat-compare/ChatComparePage";
import { ChatPage } from "@/features/playground/chat/ChatPage";
import { EmbeddingsPage } from "@/features/playground/embeddings/EmbeddingsPage";
import { ImagePage } from "@/features/playground/image/ImagePage";
import { RerankPage } from "@/features/playground/rerank/RerankPage";
import { RequestDebugPage } from "@/features/request-debug/RequestDebugPage";
import { RunCreatePage } from "@/features/runs/RunCreatePage";
import { RunDetailPage } from "@/features/runs/RunDetailPage";
import { RunListPage } from "@/features/runs/RunListPage";
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
          { path: "e2e", element: <E2ESmokePage /> },
          {
            path: "runs",
            element: <RunListPage />,
          },
          { path: "runs/new", element: <RunCreatePage /> },
          {
            path: "runs/:id",
            element: <RunDetailPage />,
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
