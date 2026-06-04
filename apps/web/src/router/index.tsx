import { Navigate, type RouteObject, useParams, useSearchParams } from "react-router-dom";
import { AlertsPage } from "@/features/alerts/AlertsPage";
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
import { BenchmarkKvCacheStressPage } from "@/features/benchmarks/BenchmarkKvCacheStressPage";
import { BenchmarkPrefixCachePage } from "@/features/benchmarks/BenchmarkPrefixCachePage";
import { BenchmarkCompareGate } from "@/features/benchmarks/compare/BenchmarkCompareGate";
import { ReportPage } from "@/features/benchmarks/compare/ReportPage";
import { SavedComparesListPage } from "@/features/benchmarks/compare/SavedComparesListPage";
import { EndpointReportsPage } from "@/features/benchmarks/EndpointReportsPage";
import { ConnectionsPage } from "@/features/connections/ConnectionsPage";
import { DeploymentRecipesPage } from "@/features/deployment-recipes";
import { DevChartsPage } from "@/features/dev-charts";
import { DiagnosticsPage } from "@/features/diagnostics/DiagnosticsPage";
import { ErrorPage } from "@/features/error/ErrorPage";
import { InsightsDetailPage } from "@/features/insights/InsightsDetailPage";
import { MeLayout } from "@/features/me/MeLayout";
import { MeNotificationsPage } from "@/features/me/MeNotificationsPage";
import { ProfilePage } from "@/features/me/ProfilePage";
import { SecurityPage } from "@/features/me/SecurityPage";
import { NotFoundPage } from "@/features/not-found/NotFoundPage";
import { AudioPage } from "@/features/playground/audio/AudioPage";
import { ChatPage } from "@/features/playground/chat/ChatPage";
import { ChatComparePage } from "@/features/playground/chat-compare/ChatComparePage";
import { EmbeddingsPage } from "@/features/playground/embeddings/EmbeddingsPage";
import { ImagePage } from "@/features/playground/image/ImagePage";
import { RerankPage } from "@/features/playground/rerank/RerankPage";
import { DatasourcesPage } from "@/features/prometheus-datasources/DatasourcesPage";
import { EvaluationCreatePage } from "@/features/quality-gate/EvaluationCreatePage";
import { EvaluationDetailPage } from "@/features/quality-gate/EvaluationDetailPage";
import { EvaluationsListPage } from "@/features/quality-gate/EvaluationsListPage";
import { RunCreatePage } from "@/features/quality-gate/RunCreatePage";
import { RunReportPage } from "@/features/quality-gate/RunReportPage";
import { RunsListPage } from "@/features/quality-gate/RunsListPage";
import { RequestDebugPage } from "@/features/request-debug/RequestDebugPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { AppShell } from "@/layouts/AppShell";

function RedirectToInsights() {
  const { connectionId } = useParams<{ connectionId: string }>();
  const [searchParams] = useSearchParams();
  const qs = searchParams.toString();
  const search = qs ? `?${qs}` : "";
  return <Navigate to={`/insights/${connectionId}${search}`} replace />;
}

// Key by `:id` so the report page remounts on report→report navigation,
// resetting its per-report state instead of leaking it across reports.
function ReportPageRoute() {
  const { id } = useParams<{ id: string }>();
  return <ReportPage key={id} />;
}

export const routes: RouteObject[] = [
  { path: "/login", element: <LoginPage />, errorElement: <ErrorPage /> },
  { path: "/register", element: <RegisterPage />, errorElement: <ErrorPage /> },
  {
    element: <ProtectedRoute />,
    errorElement: <ErrorPage />,
    children: [
      // Standalone report viewer — no AppShell so the report takes full viewport.
      // Still under ProtectedRoute so it inherits the same auth gate.
      { path: "/reports/:id", element: <ReportPageRoute /> },
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
          {
            path: "benchmarks/kv-cache-stress",
            element: <BenchmarkKvCacheStressPage />,
          },
          { path: "benchmarks/compare", element: <BenchmarkCompareGate /> },
          { path: "benchmarks/compare/saved", element: <SavedComparesListPage /> },
          { path: "benchmarks/reports", element: <EndpointReportsPage /> },
          { path: "benchmarks/reports/:connectionId", element: <RedirectToInsights /> },
          { path: "insights/:connectionId", element: <InsightsDetailPage /> },
          { path: "benchmarks/new", element: <BenchmarkCreatePage /> },
          { path: "benchmarks/:id", element: <BenchmarkDetailPage /> },
          { path: "benchmark-templates", element: <TemplateListPage /> },
          { path: "benchmark-templates/new", element: <TemplateCreatePage /> },
          { path: "benchmark-templates/:id", element: <TemplateEditPage /> },
          {
            path: "quality-gate",
            element: <Navigate to="/quality-gate/evaluations" replace />,
          },
          { path: "quality-gate/evaluations", element: <EvaluationsListPage /> },
          { path: "quality-gate/evaluations/new", element: <EvaluationCreatePage /> },
          { path: "quality-gate/evaluations/:id", element: <EvaluationDetailPage /> },
          { path: "quality-gate/runs", element: <RunsListPage /> },
          { path: "quality-gate/runs/new", element: <RunCreatePage /> },
          { path: "quality-gate/runs/:id", element: <RunReportPage /> },
          { path: "diagnostics", element: <DiagnosticsPage /> },
          { path: "debug", element: <RequestDebugPage /> },
          { path: "alerts", element: <AlertsPage /> },
          { path: "connections", element: <ConnectionsPage /> },
          {
            path: "me",
            element: <MeLayout />,
            children: [
              { index: true, element: <Navigate to="/me/profile" replace /> },
              { path: "profile", element: <ProfilePage /> },
              { path: "security", element: <SecurityPage /> },
              { path: "notifications", element: <MeNotificationsPage /> },
            ],
          },
          { path: "settings", element: <SettingsPage /> },
          { path: "settings/notifications", element: <Navigate to="/me/notifications" replace /> },
          { path: "settings/prometheus-datasources", element: <DatasourcesPage /> },
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
