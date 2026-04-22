# ModelDoctor · 前端工程约束

> 指导后续任务迭代开发。**凡新增页面、组件、store、API 必须遵守本文**;有冲突以此文为准,修改本文前需在 PR 描述里说明动机。

---

## 1. 技术栈与工具(不随意新增依赖)

| 领域 | 选型 | 备注 |
|---|---|---|
| 构建 | Vite 5 | 配置在 `web/vite.config.ts` |
| 框架 | React 18 + TypeScript 严格模式 | `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch` 全开 |
| 路由 | react-router-dom 7 | 声明式 `RouteObject[]`,集中在 `web/src/router/index.tsx` |
| 状态 | Zustand 4 + `persist` 中间件 | 不引入 Redux / Jotai / MobX |
| 异步数据 | @tanstack/react-query 5 | 只用于**有副作用的异步**(mutation + 服务端请求),不用作全局状态 |
| 表单 | react-hook-form + zod(`@hookform/resolvers/zod`) | 有校验要求的表单走 RHF;仅 UI 暂存可直接由 Zustand store 托管 |
| 样式 | Tailwind 3.4 + 设计 token + shadcn/ui 风格 | **禁止写原生 HEX / RGB 颜色**,一律走 `bg-background` / `text-foreground` / `text-destructive` 等 token |
| 图标 | lucide-react | 不混入其它图标库 |
| i18n | i18next + react-i18next | 所有用户可见文案都走 `t()`;每个 feature 一个命名空间 |
| Lint / 格式化 | Biome 1.9 一键 | `pnpm lint` / `pnpm format`;无 ESLint / Prettier |
| 测试 | Vitest + jsdom + testing-library | `pnpm test`;每个 store 至少一个 happy-path 单测 |

**新增依赖**需在 PR 描述里说明理由。能用现有依赖解决的问题不引入新库。

---

## 2. 目录分层

```
web/src/
├── components/
│   ├── ui/          ← shadcn/ui 原子组件(Button、Select、Dialog …)。不含业务。
│   ├── common/      ← 跨 feature 的展示型组件(PageHeader、EmptyState …)
│   ├── sidebar/     ← 顶层布局外壳所需组件
│   └── connection/  ← 与 connections 概念绑定的业务通用组件(EndpointPicker …)
├── features/<name>/ ← 一个功能一个文件夹,自包含
│   ├── <Name>Page.tsx   ← 顶层页面
│   ├── store.ts         ← Zustand store(见 §3)
│   ├── types.ts         ← 该 feature 的类型定义
│   └── …                ← 子组件、子 store、子 schemas
├── stores/          ← 跨 feature 的全局 store(connections、theme、locale、sidebar)
├── lib/             ← 纯函数工具(api-client、curl-parser、i18n、utils)
├── types/           ← 跨 feature 的 domain 类型(Connection、EndpointValues …)
├── router/          ← 路由表
├── layouts/         ← AppShell 外壳
├── locales/<lang>/  ← i18n 资源,一个命名空间一份 JSON
└── styles/          ← 全局样式 + tokens
```

**边界规则:**
- `components/ui/*` 不得依赖 `features/*` 或业务 store。
- `components/common/*` 不得依赖 `features/*`,但可以读**全局** store(theme/locale)。
- `features/<a>/*` **禁止**从 `features/<b>/*` import。跨 feature 的东西抽到 `components/` 或 `lib/`。
- `stores/` 下只放跨 feature 的 store,feature 内部 store 放回各 `features/<name>/store.ts`。

---

## 3. State 管理规范(Zustand 模式)

### 每个 store 的标准骨架

```ts
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface XxxState {
  // ---- data ----
  // (按语义分组,瞬态字段写明 "Transient — not persisted")

  // ---- actions ----
  resetResults: () => void;  // 只清运行态产出(results / error / progress / running)
  reset: () => void;         // 全量回到 INITIAL
}

/** 数据字段默认值的唯一真实源。actions 不能进 INITIAL。 */
const INITIAL = { /* only data fields */ } satisfies Omit<XxxState, keyof Actions>;

export const useXxxStore = create<XxxState>()(
  persist(
    (set) => ({
      ...INITIAL,
      // actions
      resetResults: () => set({ /* transient subset */ }),
      reset: () => set(INITIAL),
    }),
    {
      name: "md.<feature>.v<n>",
      partialize: (s) => ({ /* only user-input fields, NOT transient output */ }),
    },
  ),
);
```

### 硬性约定

1. **`INITIAL` 常量作为 defaults 与 `reset()` 的唯一来源**;默认值不允许重复写两遍。
2. **每个有「运行态 + 输入态」区别的 store 必须暴露 `resetResults()`**;没有运行态的 store 可以省略。
3. **`partialize` 白名单**明确列出要持久化的字段。瞬态字段(`error` / `progress` / `running` / `lastResult` / `lastResponse` / `lastError` 等)**禁止**持久化,避免刷新页面看到陈旧数据。
4. **持久化 key 命名 `md.<feature>.v<n>`**;schema 不兼容改动时 `v` 递增,不要就地改结构。
5. **瞬态运行态也进 store,不散在组件 `useState`**(理由:便于 `resetResults` 一次清干净、也便于跨组件共享、易测试)。**例外**:纯 UI 开关(`revealKey`、`detailsOpen` 这类)留在组件局部 `useState` 即可。
6. **切换连接时调 `slice.setSelected(id); slice.resetResults();`** —— 这是页面编排,不是通用组件的职责。不要给 `EndpointPicker` 加 `onReset` prop。
7. **Action 命名**:`setXxx`(局部 setter)、`patch(key, value)`(通用 patch,仅在字段过多时使用)、`resetResults`、`reset`。避免 `clearAll`、`doReset` 等不一致命名。
8. **Selector 粒度:** 组件只订阅自己需要的字段,`const x = useStore((s) => s.x)`;不要全量 `const s = useStore()` 然后取属性,会导致无关更新也重渲染。**例外**:页面顶层可以全量订阅,子组件必须粒度订阅。

### 已有 store 的范例

- 参照 `features/e2e-smoke/store.ts` 与 `features/load-test/store.ts`(已按此范式重构)。
- 全局 store 不需要 `INITIAL` 约定(字段少、无「运行态」概念),按 `stores/theme-store.ts` 的形态写。

---

## 4. API 调用规范

1. **前端一律走 `@/lib/api-client`**(`api.get` / `api.post`)。**禁止**直接 `fetch('/api/...')`。
2. **错误类型:** `ApiError(status, message)`;所有调用方要准备 `catch (e) { if (e instanceof ApiError) … }` 或通过 react-query 的 `onError`。
3. **异步副作用:** 用 `useMutation`(或 `useQuery`),不要手写 `useState({ loading, data, error })` 模板。
4. **服务端所有路由挂在 `/api/*`**(见 `server.js`)。前端 dev 通过 Vite 的 `proxy` 走到 `:3001`。
5. **SSE / streaming**:目前未使用;如需引入,应走 `api-client` 新增 `stream` 方法统一封装。
6. **Schema 校验:** 来自**用户输入**或**不可信源**的数据用 zod 校验(参考 `features/connections/schema.ts`);**可信本地 API** 的响应可以直接类型断言,但应拿到回复后立刻归一化,**不要把任意 JSON 散播到组件树**。

---

## 5. UI / 组件规范

### 颜色与排版

- 只用 token:`bg-background` / `bg-card` / `bg-muted` / `text-foreground` / `text-muted-foreground` / `text-destructive` / `text-success` / `text-warning` / `border-border` / `border-input` / `ring-ring`。
- **禁止**在 JSX / className 里写 `#fff` / `rgb(…)` / `red-500` 之类的裸色值。新增 token 改 `web/src/styles/globals.css` 与 `web/tailwind.config.ts`,同时改亮色和暗色两套。
- 字体:通过 `body` 的 `font-sans`(tailwind 默认 stack)。代码 / 数据用 `font-mono`。
- 圆角一律走 `rounded-md` / `rounded-lg`,半径 token 是 `--radius: 0.5rem`。

### 组件分层

- **`components/ui/*`** 等同于 shadcn/ui 的原子层。**禁止**加业务文案、禁止 i18n;只接受 `className` 和基础 props。
- **`components/common/*` & `components/connection/*`** 可以 i18n、可以读全局 store,但**不得**读 feature store。
- **feature 子组件** 放 `features/<name>/` 下,可以自由读该 feature 的 store。

### 连接组件:`EndpointPicker` vs `EndpointSelector`

两者都在 `components/connection/`,但定位不同,不得互换:

| 组件 | 位置 | 用于 |
|---|---|---|
| **`EndpointPicker`** | 内嵌在页面 body 的 Endpoint 卡片里 | 用户需要**同时看到并编辑** API URL / Key / Model 的主流程页(E2E Smoke、Load Test) |
| **`EndpointSelector`** | 页面 header 的右上角紧凑位 | 端点是辅助性的、用户主要**只是切换**已保存连接(Request Debug) |

判断规则:**如果页面主流程里用户要改 URL / Key / Model,用 `EndpointPicker`;如果只是从下拉里挑一个已保存的,用 `EndpointSelector`。**
不要在同一个页面里同时出现两个连接组件。

### 可访问性(最低要求)

- 所有 `Input` / `Textarea` 必须有 `<Label htmlFor>` 关联,或有 `aria-label`。当前 `EndpointPicker` 里没绑定 id,后续修改该文件时请一并修掉。
- 可交互元素(button、label)必须有可见焦点样式(shadcn 组件默认带 `focus-visible:ring-*`,不要删除)。
- 图标按钮必须加 `aria-label`。
- 表单错误:inline 展示 + `text-destructive` token,**禁止** `window.alert()`(历史遗留在 `E2ESmokePage.runProbes` 要改)。

### 反馈模式

| 场景 | 正确做法 | 禁止 |
|---|---|---|
| 表单校验错误(随输入即时反馈) | inline `<p className="text-destructive">` 紧贴字段 | `alert()` / `confirm()` |
| 结果区常驻状态(压测完成、E2E 各 probe 成败) | shadcn `<Alert>` 或结果卡片(保留细节、可复制) | 用 toast 顶掉详细数据 |
| 瞬态操作反馈(cURL 解析成功 / 保存成功 / 连接已更新) | sonner `toast.success` / `toast.error`(右下角、2 秒自动消失) | inline 小 chip + `setTimeout` 手动消失 |
| 需要用户决策 | shadcn `<AlertDialog>` | `confirm()` / `prompt()` |

sonner 的 `<Toaster />` 在 `App.tsx` 里挂载,自动跟随 `useThemeStore.mode`。页面内引入 `import { toast } from "sonner"` 直接用。

---

## 6. i18n 规范

1. **所有用户可见字符串必须走 `t()`**,包括占位符 `placeholder`、`aria-label`、错误文案、Badge 文字。**禁止**在 JSX / JS 字面量中写中文或英文文案。
2. **命名空间划分:** 每个 feature 一个 namespace(`load-test` / `e2e` / `debug` / `connections` / `settings` / `sidebar`),跨 feature 复用的放 `common`。
3. **新 key 必须同时加 `zh-CN` 和 `en-US` 两份**,并在 `lib/i18n.ts` 的 resources / ns 数组里注册。缺失的 key 在构建时会穿透显示,视为严重 UI bug。
4. **key 命名:**`<section>.<field>` 两层即可(`fields.apiUrl`、`actions.save`、`alerts.failure`);过多层级难维护。
5. **插值用 `{{var}}`,不要字符串拼接**(`t("alerts.failure", { error: msg })`)。

---

## 7. 表单规范

- **有服务端持久化、有校验要求的表单**(如「新建/编辑连接」)走 react-hook-form + zod + shadcn `form`。参考 `ConnectionDialog`。
- **仅 UI 暂存的表单**(Load Test 参数、Request Debug 请求体等)直接受 Zustand store 托管即可,不必引 RHF。理由:每个字段都要跨导航持久化,RHF 的本地 form state 反而绕道。
- **cURL 解析的填充逻辑**已在 `lib/curl-parser.ts`(词法 / 语法)与 `lib/apply-curl-to-endpoint.ts`(ParsedCurl → EndpointValues 的 patch)分两层提供;新的导入场景复用这两个,不要各自实现一遍。

---

## 8. 路由与侧边栏

1. 路由配置唯一入口:`web/src/router/index.tsx`。新增页面 = 加一条 `{ path, element }`。
2. 侧边栏是**数据驱动**的(`components/sidebar/sidebar-config.tsx`),新功能:
   - 在 `sidebarGroups` 里加一条 `SidebarItem`;
   - 如果尚未实装,`comingSoon: true` 会自动挂 Badge 并走 `ComingSoonRoute` 占位;
   - 新功能的 `labelKey` 必须同步更新 `locales/<lang>/sidebar.json`。
3. 错误兜底:根路由的 `errorElement: <ErrorPage />` 处理未捕获异常;`*` catch-all 指向 `<NotFoundPage />`。业务代码不需要自己加 top-level try/catch。

---

## 9. 测试基线

1. **`pnpm test` 必须绿**(CI 前置条件)。跑法:`pnpm test` 而不是任意自定义命令(会漏掉 `setupFiles` 和 jsdom env)。
2. **每个 Zustand store 至少一条 happy-path 测试**(参见 `connections-store.test.ts`、`theme-store.test.ts`)。
3. **纯函数(parser、formatter、utils)必须带测试**,`curl-parser.test.ts` 是范式。
4. **UI 组件**目前不强制单测,但复杂交互页(E2E、Load Test)后续应加 `@testing-library/react` 的集成测试。
5. 后端跑 `pnpm test:backend`(独立 config `vitest.backend.config.ts`)。

---

## 10. 服务端规范(supplementary)

- 路由分模块:`src/routes/<feature>.js`,通过 `app.use("/api", <router>)` 挂载。
- Probe / builder 分层:`src/probes/*.js` 组合 `src/builders/*.js` 得到请求体。**禁止**在 route 里直接写请求体字面量。
- 新增 API 必须在前端 `lib/api-client.ts` 调用时用明确 TypeScript 类型,不滥用 `any`。

---

## 11. Git / 分支工作流

- 仓库是 **bare + worktree 布局**(`/Users/fangyong/vllm/modeldoctor/` 下的 `.bare` + `main/` + `feat/<name>/`)。
- **feature 开发只在对应 worktree 里改**,**不要**同时改 `main/` 工作区(即使开发服务器跑在另一个 worktree,也不要双写)。让 `main` 通过合并获取变更。
- 开发服务器端口:默认 Vite `5173` / Express `3001`。多 worktree 同时跑 `pnpm dev` 时,后续的 worktree 用 env 覆盖,例如
  ```bash
  VITE_PORT=5174 API_PORT=3002 pnpm dev
  ```
  `vite.config.ts` 里 `server.port` 和 `proxy["/api"].target` 都读这对环境变量,保证 Vite→Express 的代理对齐(见 README)。
- 提交信息沿用 `type: short desc` 前缀(feat/fix/refactor/ui/chore/docs/i18n),参见 `git log`。

---

## 12. 反模式清单(代码评审时逐条检查)

- [ ] 在 JSX 里用 `alert()` / `confirm()` / `prompt()`
- [ ] 用裸色值(`#fff`、`red-500`)代替 token
- [ ] 在组件里硬编码中英文文案
- [ ] 把瞬态运行态(error / progress / loading)留在组件 `useState`
- [ ] 绕过 `api-client`,直接 `fetch('/api/...')`
- [ ] 跨 feature 直接 import(`features/a` → `features/b`)
- [ ] store 里 defaults 和 `reset` 两处写默认值
- [ ] 新 i18n key 只加中文或只加英文
- [ ] `components/ui/*` 里加业务逻辑或 `useTranslation`
- [ ] 组件暴露命令式 `ref.reset()`(React 社区反模式;declarative store action 才是标准)
- [ ] 把 `any` 引入公共类型
- [ ] Zustand selector 全量订阅 + 属性读取(应粒度订阅)

---

## 13. 当前待清理清单(存量债务)

以下是审计出的具体问题,按优先级排列。**每条都应转成一个任务或 issue**,逐条消化。✅ 表示已完成。

### 高优先级(影响用户体验或正确性)

1. ✅ **`LocaleStore` 初次访问可能语言错配** —— 已修(`main.tsx` 渲染前同步 `i18n.changeLanguage(store.locale)`,`i18n.init` 去掉硬写 `lng`)。
2. ✅ **`E2ESmokePage` 用 `window.alert()`** —— 已改为 Run 按钮 `disabled` + `title` tooltip。
3. ✅ **`EndpointPicker` Label 未绑 Input** —— 已用 `useId()` 绑定 `htmlFor` / `id`。

### 中优先级(结构 / 可维护性)

4. ✅ **两个连接组件职责** —— 已在 §5 登记并在两者 JSDoc 中说明。
5. ✅ **「另存为」UI 重复** —— 已统一到 `ConnectionDialog`,`EndpointSelector` 的 `NamePrompt` 与无人使用的 save 回调已删。
6. ✅ **cURL 解析填表重复** —— 已抽到 `lib/apply-curl-to-endpoint.ts`,两处消费者共用。
7. ✅ **`LoadTestSlice.modified` / `curlExpanded`** —— 已删除(含 `setModified` 与 `@deprecated ManualEndpoint` 类型别名)。
8. ✅ **`RequestDebugPage` 的 `modified={false}`** —— 已删除该 prop 传递。Request Debug 不承载「保存当前修改回连接」语义,dirty 指示器在此无意义。

### 低优先级(收尾)

9. ✅ **本地接口响应 interface 散在 Page** —— 已移到各 feature 的 `types.ts`(`E2ETestResponse` / `DebugProxyResponse`)。

10. ✅ **`reset()` 无 UI 触发** —— Settings 页新增「清除测试数据」按钮,调用三个 feature store 的 `reset()`,保留连接库和外观偏好。与原「重置应用状态」(nuclear,清 localStorage + reload)形成两档粒度。

---

## 14. 新增 feature 的标准动作清单

面对「加一个新页面」的任务时,按这个 checklist 走:

1. **路由:** `web/src/router/index.tsx` 加 `{ path: "/<name>", element: <XxxPage /> }`;占位阶段可用 `<ComingSoonRoute icon={…} itemKey="…" />`。
2. **侧边栏:** `components/sidebar/sidebar-config.tsx` 在对应 group 加 `SidebarItem`;未实装写 `comingSoon: true`。
3. **i18n:** `locales/zh-CN/<name>.json` 与 `locales/en-US/<name>.json` 两份,`lib/i18n.ts` 注册新 namespace。
4. **目录:** 新建 `features/<name>/`,最小包含 `XxxPage.tsx` + `store.ts` + `types.ts`。
5. **Store:** 按 §3 模板写,包含 `INITIAL` / `resetResults` / `reset` / `partialize`。
6. **连接:** 需要调模型 API 的页面,直接用 `EndpointPicker` 内嵌于 Endpoint 卡片。
7. **切换连接编排:** 页面 `onSelect={(id) => { slice.setSelected(id); slice.resetResults(); }}`。
8. **调用后端:** `api.post<TResponse>("/api/<feature>", body)` + `useMutation`,**不要**直接 `fetch`。
9. **测试:** 至少为新 store 写 happy-path 测试;纯函数逻辑补单测。
10. **验证:** `pnpm type-check && pnpm lint && pnpm test` 全绿。

---

## 15. 变更本文

本文是**单一真实源**。修改规则或新增约定时:
- 在 PR 描述里列出变更条款;
- 如果变更会让既有代码违规,PR 必须一并修掉既有违规,或新增条目到「存量债务」。
