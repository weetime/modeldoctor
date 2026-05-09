import { LoginPage } from "@/features/auth/LoginPage";
import { ProtectedRoute } from "@/features/auth/ProtectedRoute";
import { RegisterPage } from "@/features/auth/RegisterPage";
import { TemplateCreatePage } from "@/features/benchmark-templates/TemplateCreatePage";
import { TemplateEditPage } from "@/features/benchmark-templates/TemplateEditPage";
import { TemplateListPage } from "@/features/benchmark-templates/TemplateListPage";
import { BenchmarkCapacityPage } from "@/features/benchmarks/BenchmarkCapacityPage";
import { BenchmarkCreatePage } from "@/features/benchmarks/BenchmarkCreatePage";
import { BenchmarkDetailPage } from "@/features/benchmarks/BenchmarkDetailPage";
import { BenchmarkGatewayPage } from "@/features/benchmarks/BenchmarkGatewayPage";
import { BenchmarkInferencePage } from "@/features/benchmarks/BenchmarkInferencePage";
import { BenchmarkPrefixCachePage } from "@/features/benchmarks/BenchmarkPrefixCachePage";
import { EndpointReportsPage } from "@/features/benchmarks/EndpointReportsPage";
import { BenchmarkCompareGate } from "@/features/benchmarks/compare/BenchmarkCompareGate";
import { ConnectionsPage } from "@/features/connections/ConnectionsPage";
import { DeploymentRecipesPage } from "@/features/deployment-recipes";
import { DevChartsPage } from "@/features/dev-charts";
import { DiagnosticsPage } from "@/features/diagnostics/DiagnosticsPage";
import { ErrorPage } from "@/features/error/ErrorPage";
import { InsightsDetailPage } from "@/features/insights/InsightsDetailPage";
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
import { Navigate, type RouteObject, useParams, useSearchParams } from "react-router-dom";

function RedirectToInsights() {
  const { connectionId } = useParams<{ connectionId: string }>();
  const [searchParams] = useSearchParams();
  const qs = searchParams.toString();
  const search = qs ? `?${qs}` : "";
  return <Navigate to={`/insights/${connectionId}${search}`} replace />;
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
          { index: true, element: <Navigate to="/benchmarks/inference" replace /> },
          {
            path: "benchmarks",
            element: <Navigate to="/benchmarks/inference" replace />,
          },
          { path: "benchmarks/inference", element: <BenchmarkInferencePage /> },
          { path: "benchmarks/capacity", element: <BenchmarkCapacityPage /> },
          { path: "benchmarks/gateway", element: <BenchmarkGatewayPage /> },
          {
            path: "benchmarks/prefix-cache-validation",
            element: <BenchmarkPrefixCachePage />,
          },
          { path: "benchmarks/compare", element: <BenchmarkCompareGate /> },
          { path: "benchmarks/reports", element: <EndpointReportsPage /> },
          { path: "benchmarks/reports/:connectionId", element: <RedirectToInsights /> },
          { path: "insights/:connectionId", element: <InsightsDetailPage /> },
          { path: "benchmarks/new", element: <BenchmarkCreatePage /> },
          { path: "benchmarks/:id", element: <BenchmarkDetailPage /> },
          { path: "benchmark-templates", element: <TemplateListPage /> },
          { path: "benchmark-templates/new", element: <TemplateCreatePage /> },
          { path: "benchmark-templates/:id", element: <TemplateEditPage /> },
          { path: "diagnostics", element: <DiagnosticsPage /> },
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
          { path: "dev/deployments", element: <DeploymentRecipesPage /> },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
];
