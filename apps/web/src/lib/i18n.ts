import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enBenchmark from "@/locales/en-US/benchmark.json";
import enCommon from "@/locales/en-US/common.json";
import enConnections from "@/locales/en-US/connections.json";
import enDebug from "@/locales/en-US/debug.json";
import enE2E from "@/locales/en-US/e2e.json";
import enLoadTest from "@/locales/en-US/load-test.json";
import enSettings from "@/locales/en-US/settings.json";
import enSidebar from "@/locales/en-US/sidebar.json";
import zhBenchmark from "@/locales/zh-CN/benchmark.json";
import zhCommon from "@/locales/zh-CN/common.json";
import zhConnections from "@/locales/zh-CN/connections.json";
import zhDebug from "@/locales/zh-CN/debug.json";
import zhE2E from "@/locales/zh-CN/e2e.json";
import zhLoadTest from "@/locales/zh-CN/load-test.json";
import zhSettings from "@/locales/zh-CN/settings.json";
import zhSidebar from "@/locales/zh-CN/sidebar.json";

void i18n.use(initReactI18next).init({
  resources: {
    "en-US": {
      common: enCommon,
      sidebar: enSidebar,
      connections: enConnections,
      "load-test": enLoadTest,
      e2e: enE2E,
      debug: enDebug,
      settings: enSettings,
      benchmark: enBenchmark,
    },
    "zh-CN": {
      common: zhCommon,
      sidebar: zhSidebar,
      connections: zhConnections,
      "load-test": zhLoadTest,
      e2e: zhE2E,
      debug: zhDebug,
      settings: zhSettings,
      benchmark: zhBenchmark,
    },
  },
  // `lng` is set by main.tsx from the locale store before first render.
  fallbackLng: "en-US",
  defaultNS: "common",
  ns: ["common", "sidebar", "connections", "load-test", "e2e", "debug", "settings", "benchmark"],
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
