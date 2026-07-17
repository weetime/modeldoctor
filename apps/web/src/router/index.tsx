import { Navigate, type RouteObject, useParams, useSearchParams } from "react-router-dom";
import { AlertsPage } from "@/features/alerts/AlertsPage";
import { LoginPage } from "@/features/auth/LoginPage";
import { ProtectedRoute } from "@/features/auth/ProtectedRoute";
import { RegisterPage } from "@/features/auth/RegisterPage";
import { TemplateCreatePage } from "@/features/benchmark-templates/TemplateCreatePage";
import { TemplateEditPage } from "@/features/benchmark-templates/TemplateEditPage";
import { TemplateListPage } from "@/features/benchmark-templates/TemplateListPage";
import { BenchmarkAgentPage } from "@/features/benchmarks/BenchmarkAgentPage";
import { BenchmarkCapacityPage } from "@/features/benchmarks/BenchmarkCapacityPage";
import { BenchmarkCreatePage } from "@/features/benchmarks/BenchmarkCreatePage";
import { BenchmarkDetailPage } from "@/features/benchmarks/BenchmarkDetailPage";
import { BenchmarkGatewayPage } from "@/features/benchmarks/BenchmarkGatewayPage";
import { BenchmarkInferencePage } from "@/features/benchmarks/BenchmarkInferencePage";
import { BenchmarkKvCacheStressPage } from "@/features/benchmarks/BenchmarkKvCacheStressPage";
import { BenchmarkOmniPage } from "@/features/benchmarks/BenchmarkOmniPage";
import { BenchmarkPrefixCachePage } from "@/features/benchmarks/BenchmarkPrefixCachePage";
import { BenchmarkCompareGate } from "@/features/benchmarks/compare/BenchmarkCompareGate";
import { ReportDetailPage } from "@/features/benchmarks/compare/ReportDetailPage";
import { ReportPreviewPage } from "@/features/benchmarks/compare/ReportPreviewPage";
import { SavedComparesListPage } from "@/features/benchmarks/compare/SavedComparesListPage";
import { ConnectionsPage } from "@/features/connections/ConnectionsPage";
import { DeploymentRecipesPage } from "@/features/deployment-recipes";
import { DevChartsPage } from "@/features/dev-charts";
import { DiagnosticsPage } from "@/features/diagnostics/DiagnosticsPage";
import { ErrorPage } from "@/features/error/ErrorPage";
import { InsightsDetailPage } from "@/features/insights/InsightsDetailPage";
import { InsightsMatrixPage } from "@/features/insights/InsightsMatrixPage";
import { LlmJudgeProvidersPage } from "@/features/llm-judge-providers/LlmJudgeProvidersPage";
import { McpServersPage } from "@/features/mcp-servers/McpServersPage";
import { MeLayout } from "@/features/me/MeLayout";
import { MeNotificationsPage } from "@/features/me/MeNotificationsPage";
import { ProfilePage } from "@/features/me/ProfilePage";
import { SecurityPage } from "@/features/me/SecurityPage";
import { NotFoundPage } from "@/features/not-found/NotFoundPage";
import { AgentPage } from "@/features/playground/agent/AgentPage";
import { AudioPage } from "@/features/playground/audio/AudioPage";
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
import { SkillsPage } from "@/features/skills/SkillsPage";
import { AppShell } from "@/layouts/AppShell";

function RedirectToInsights() {
  const { connectionId } = useParams<{ connectionId: string }>();
  const [searchParams] = useSearchParams();
  const qs = searchParams.toString();
  const search = qs ? `?${qs}` : "";
  return <Navigate to={`/insights/${connectionId}${search}`} replace />;
}

// Key by `:id` so the detail page remounts on report→report navigation,
// resetting its per-report state instead of leaking it across reports.
function ReportDetailRoute() {
  const { id } = useParams<{ id: string }>();
  return <ReportDetailPage key={id} />;
}

export const routes: RouteObject[] = [
  { path: "/login", element: <LoginPage />, errorElement: <ErrorPage /> },
  { path: "/register", element: <RegisterPage />, errorElement: <ErrorPage /> },
  {
    element: <ProtectedRoute />,
    errorElement: <ErrorPage />,
    children: [
      // Standalone report PREVIEW — no AppShell so the report takes full
      // viewport and the print DOM stays clean. The themed in-app detail page
      // lives at `/reports/:id` inside AppShell (see below).
      { path: "/reports/:id/preview", element: <ReportPreviewPage /> },
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
            path: "benchmarks/lb-strategy",
            element: <BenchmarkPrefixCachePage />,
          },
          {
            path: "benchmarks/engine-kv-cache",
            element: <BenchmarkKvCacheStressPage />,
          },
          { path: "benchmarks/agent", element: <BenchmarkAgentPage /> },
          { path: "benchmarks/omni", element: <BenchmarkOmniPage /> },
          { path: "benchmarks/compare", element: <BenchmarkCompareGate /> },
          { path: "benchmarks/compare/saved", element: <SavedComparesListPage /> },
          { path: "reports/:id", element: <ReportDetailRoute /> },
          { path: "benchmarks/reports", element: <InsightsMatrixPage /> },
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
          { path: "mcp-servers", element: <McpServersPage /> },
          { path: "skills", element: <SkillsPage /> },
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
          { path: "settings/llm-judge-providers", element: <LlmJudgeProvidersPage /> },
          { path: "playground", element: <Navigate to="/playground/agent" replace /> },
          { path: "playground/chat", element: <Navigate to="/playground/agent" replace /> },
          { path: "playground/chat/compare", element: <ChatComparePage /> },
          { path: "playground/image", element: <ImagePage /> },
          { path: "playground/audio", element: <AudioPage /> },
          { path: "playground/embeddings", element: <EmbeddingsPage /> },
          { path: "playground/rerank", element: <RerankPage /> },
          { path: "playground/agent", element: <AgentPage /> },
          { path: "dev/charts", element: <DevChartsPage /> },
          { path: "dev/deployments", element: <DeploymentRecipesPage /> },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
];
