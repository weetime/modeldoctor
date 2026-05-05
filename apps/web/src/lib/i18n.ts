import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enBenchmarkTemplates from "@/locales/en-US/benchmark-templates.json";
import enBenchmarks from "@/locales/en-US/benchmarks.json";
import enCommon from "@/locales/en-US/common.json";
import enConnections from "@/locales/en-US/connections.json";
import enDebug from "@/locales/en-US/debug.json";
import enDiagnostics from "@/locales/en-US/diagnostics.json";
import enPlayground from "@/locales/en-US/playground.json";
import enSettings from "@/locales/en-US/settings.json";
import enSidebar from "@/locales/en-US/sidebar.json";
import zhBenchmarkTemplates from "@/locales/zh-CN/benchmark-templates.json";
import zhBenchmarks from "@/locales/zh-CN/benchmarks.json";
import zhCommon from "@/locales/zh-CN/common.json";
import zhConnections from "@/locales/zh-CN/connections.json";
import zhDebug from "@/locales/zh-CN/debug.json";
import zhDiagnostics from "@/locales/zh-CN/diagnostics.json";
import zhPlayground from "@/locales/zh-CN/playground.json";
import zhSettings from "@/locales/zh-CN/settings.json";
import zhSidebar from "@/locales/zh-CN/sidebar.json";

void i18n.use(initReactI18next).init({
  resources: {
    "en-US": {
      common: enCommon,
      sidebar: enSidebar,
      connections: enConnections,
      diagnostics: enDiagnostics,
      benchmarks: enBenchmarks,
      "benchmark-templates": enBenchmarkTemplates,
      debug: enDebug,
      settings: enSettings,
      playground: enPlayground,
    },
    "zh-CN": {
      common: zhCommon,
      sidebar: zhSidebar,
      connections: zhConnections,
      diagnostics: zhDiagnostics,
      benchmarks: zhBenchmarks,
      "benchmark-templates": zhBenchmarkTemplates,
      debug: zhDebug,
      settings: zhSettings,
      playground: zhPlayground,
    },
  },
  // `lng` is set by main.tsx from the locale store before first render.
  fallbackLng: "en-US",
  defaultNS: "common",
  ns: [
    "common",
    "sidebar",
    "connections",
    "diagnostics",
    "benchmarks",
    "benchmark-templates",
    "debug",
    "settings",
    "playground",
  ],
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
