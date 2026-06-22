import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { z } from "zod";

import enAlerts from "@/locales/en-US/alerts.json";
import enBenchmarkTemplates from "@/locales/en-US/benchmark-templates.json";
import enBenchmarks from "@/locales/en-US/benchmarks.json";
import enCommands from "@/locales/en-US/commands.json";
import enCommon from "@/locales/en-US/common.json";
import enConnections from "@/locales/en-US/connections.json";
import enDebug from "@/locales/en-US/debug.json";
import enDeploymentRecipes from "@/locales/en-US/deployment-recipes.json";
import enDiagnostics from "@/locales/en-US/diagnostics.json";
import enEngineMetrics from "@/locales/en-US/engine-metrics.json";
import enInsights from "@/locales/en-US/insights.json";
import enLlmJudgeProviders from "@/locales/en-US/llm-judge-providers.json";
import enMe from "@/locales/en-US/me.json";
import enNotifications from "@/locales/en-US/notifications.json";
import enPlayground from "@/locales/en-US/playground.json";
import enPrometheusDatasources from "@/locales/en-US/prometheus-datasources.json";
import enQualityGate from "@/locales/en-US/quality-gate.json";
import enSettings from "@/locales/en-US/settings.json";
import enSidebar from "@/locales/en-US/sidebar.json";
import zhAlerts from "@/locales/zh-CN/alerts.json";
import zhBenchmarkTemplates from "@/locales/zh-CN/benchmark-templates.json";
import zhBenchmarks from "@/locales/zh-CN/benchmarks.json";
import zhCommands from "@/locales/zh-CN/commands.json";
import zhCommon from "@/locales/zh-CN/common.json";
import zhConnections from "@/locales/zh-CN/connections.json";
import zhDebug from "@/locales/zh-CN/debug.json";
import zhDeploymentRecipes from "@/locales/zh-CN/deployment-recipes.json";
import zhDiagnostics from "@/locales/zh-CN/diagnostics.json";
import zhEngineMetrics from "@/locales/zh-CN/engine-metrics.json";
import zhInsights from "@/locales/zh-CN/insights.json";
import zhLlmJudgeProviders from "@/locales/zh-CN/llm-judge-providers.json";
import zhMe from "@/locales/zh-CN/me.json";
import zhNotifications from "@/locales/zh-CN/notifications.json";
import zhPlayground from "@/locales/zh-CN/playground.json";
import zhPrometheusDatasources from "@/locales/zh-CN/prometheus-datasources.json";
import zhQualityGate from "@/locales/zh-CN/quality-gate.json";
import zhSettings from "@/locales/zh-CN/settings.json";
import zhSidebar from "@/locales/zh-CN/sidebar.json";

void i18n.use(initReactI18next).init({
  resources: {
    "en-US": {
      common: enCommon,
      sidebar: enSidebar,
      alerts: enAlerts,
      connections: enConnections,
      diagnostics: enDiagnostics,
      benchmarks: enBenchmarks,
      "benchmark-templates": enBenchmarkTemplates,
      debug: enDebug,
      settings: enSettings,
      playground: enPlayground,
      insights: enInsights,
      commands: enCommands,
      "deployment-recipes": enDeploymentRecipes,
      "engine-metrics": enEngineMetrics,
      notifications: enNotifications,
      me: enMe,
      "quality-gate": enQualityGate,
      "prometheus-datasources": enPrometheusDatasources,
      "llm-judge-providers": enLlmJudgeProviders,
    },
    "zh-CN": {
      common: zhCommon,
      sidebar: zhSidebar,
      alerts: zhAlerts,
      connections: zhConnections,
      diagnostics: zhDiagnostics,
      benchmarks: zhBenchmarks,
      "benchmark-templates": zhBenchmarkTemplates,
      debug: zhDebug,
      settings: zhSettings,
      playground: zhPlayground,
      insights: zhInsights,
      commands: zhCommands,
      "deployment-recipes": zhDeploymentRecipes,
      "engine-metrics": zhEngineMetrics,
      notifications: zhNotifications,
      me: zhMe,
      "quality-gate": zhQualityGate,
      "prometheus-datasources": zhPrometheusDatasources,
      "llm-judge-providers": zhLlmJudgeProviders,
    },
  },
  // `lng` is set by main.tsx from the locale store before first render.
  fallbackLng: "en-US",
  defaultNS: "common",
  ns: [
    "common",
    "sidebar",
    "alerts",
    "connections",
    "diagnostics",
    "benchmarks",
    "benchmark-templates",
    "debug",
    "settings",
    "playground",
    "insights",
    "commands",
    "deployment-recipes",
    "engine-metrics",
    "notifications",
    "me",
    "quality-gate",
    "prometheus-datasources",
    "llm-judge-providers",
  ],
  interpolation: { escapeValue: false },
  returnNull: false,
});

// `.refine(fn, { message: "validation.someKey" })` cannot be translated here
// because zod v3 short-circuits the errorMap when a refine message is set
// explicitly. Translation for those `validation.*` raw strings happens at
// render time inside `<FormMessage>` (apps/web/src/components/ui/form.tsx).
z.setErrorMap((issue, ctx) => {
  switch (issue.code) {
    case "invalid_type": {
      if (issue.received === "undefined") {
        return { message: i18n.t("validation.required", { ns: "common" }) };
      }
      return { message: i18n.t("validation.invalidType", { ns: "common" }) };
    }
    case "too_small": {
      if (issue.type === "string") {
        if (issue.minimum === 1) {
          return { message: i18n.t("validation.required", { ns: "common" }) };
        }
        return {
          message: i18n.t("validation.tooShort", { ns: "common", min: issue.minimum }),
        };
      }
      return {
        message: i18n.t("validation.tooSmall", { ns: "common", min: issue.minimum }),
      };
    }
    case "too_big": {
      if (issue.type === "string") {
        return { message: i18n.t("validation.tooLong", { ns: "common", max: issue.maximum }) };
      }
      return { message: i18n.t("validation.tooBig", { ns: "common", max: issue.maximum }) };
    }
    case "invalid_string": {
      if (issue.validation === "email")
        return { message: i18n.t("validation.invalidEmail", { ns: "common" }) };
      if (issue.validation === "url")
        return { message: i18n.t("validation.invalidUrl", { ns: "common" }) };
      if (issue.validation === "regex")
        return { message: i18n.t("validation.invalidFormat", { ns: "common" }) };
      return { message: ctx.defaultError };
    }
    case "invalid_enum_value":
      return { message: i18n.t("validation.invalidEnum", { ns: "common" }) };
    default:
      return { message: ctx.defaultError };
  }
});

export default i18n;
