# LLM Judge fail-fast：缺裁判时拒绝创建 run + 清理 phantom schema

**Status:** draft · 2026-05-28
**Scope:** `apps/api/src/modules/quality-gate` + `packages/contracts/src/quality-gate`
**Tracks:** 无 issue（可选开 `fix/llm-judge-fail-fast` 单 PR）
**Out of scope:** per-run / per-eval 裁判覆盖、`"AI Diagnostics (Global)"` 改名 / 拆分、其他模块的 phantom schema sweep

## 问题

当系统未配置启用的 LLM judge provider 时，含 `kind:"llm-judge"` 样本的评测 run 仍能创建并跑完，但每条 llm-judge 样本被静默判 `passed:false`（错误信息塞进 `result.judge.error`），最终：

- `run.status = COMPLETED`（看起来执行没事）
- `aggregate.totalErrors = 0`（端点调用零错误）
- `passRateA ≈ 0`，`gate_result = FAILED`（伪装成质量门禁失败）

用户在 UI 上看到的是"模型不行 / 通过率 0%"，根因其实是"裁判没配"——基础设施 / 配置问题被错放到了质量判定语义里。

### 证据链（2026-05-28 实际数据）

```
run cmposedoh001m5xkan61xe2iq (中文摘要质量, 6 samples)
  status=COMPLETED, gate_result=FAILED, totalErrors=0, passRateA=0
  result_a.call.rawAnswer = "苹果公司于2026年发布的Vision Pro 2售价2999美元…"  ← 模型答出来了
  result_a.judge.error    = "No enabled LLM judge provider configured. Configure one at Settings → LLM Judge."
```

### 根因点位

`apps/api/src/modules/quality-gate/judges/llm-judge.ts:73-74` 的 catch 把所有判分异常（含"无 provider"这种**配置缺失**）一律降级成 `{ passed:false, error:msg }`。该结果不计入 `totalErrors`、不抛出执行器，被当成"模型这条没通过"参与聚合。

### 顺带的 dead surface

`packages/contracts/src/quality-gate/judge-config.ts:27` 定义的 `judgeModel: z.object({ connectionId: z.string() }).optional()` 是个 phantom 字段：

| 层 | 现状 |
|---|---|
| Schema | 允许传 |
| Runtime adapter (`judges.service.ts:20-36`) | **完全忽略** `input.connectionId` |
| 10 个 seed 内置评测 | 0 处使用 |
| Web UI（`EvaluationSampleEditor` / `SamplesTableEditor`） | 0 处暴露 |
| DB（`evaluations.samples` + `evaluation_runs.evaluation_snapshot` JSONB） | 0 行携带 |
| 所有 test / spec | 0 处断言 |

留着只会让阅读者误以为"每条 judge 可指定连接"是已实现能力。

## 设计目标

1. **缺裁判时拒绝创建 run** —— 把"无 provider"从"运行时静默降级"提前到"创建时显式拒绝"，让 `run.status` 如实反映执行能不能跑、不再制造伪 0% pass rate
2. **清理 phantom schema** —— 一次性删掉 `judgeModel` 三处（schema 1 行 + interface 1 行 + call site 1 行），零数据迁移

## 为什么这样设计

### 业内共识：单一全局裁判已是主流

文献和工业实践对 LLM-as-judge 的 model 选择有明确共识 ——**裁判和被测应跨家族**，且通常**一个强大的外部裁判 + 全局默认**就够。证据：

- [*Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena*](https://arxiv.org/abs/2306.05685) (Zheng et al., 2023) ——"GPT-4 favors itself with 10% higher win rate, Claude-v1 favors itself with 25% higher win rate. Don't let one model be both contestant and judge."
- [*Self-Preference Bias in LLM-as-a-Judge*](https://arxiv.org/abs/2410.21819) (EMNLP 2025) —— 记录 "positive self-bias and family-bias"
- 工业产品：MT-Bench / AlpacaEval / Arena-Hard 统一 GPT-4 / GPT-4o 当裁判；Promptfoo / DeepEval / Braintrust / Langfuse 默认 GPT-4 系或 Claude Sonnet 系，per-test 覆盖是可选高级用法

ModelDoctor 当前的"singleton `LlmJudgeService` + DeepSeek 当裁判 + 多家 Qwen 当被测"——**已经符合业内最佳实践**，不需要再加 per-run / per-eval 覆盖能力。该删的不是 singleton 设计，是那个**没人用的 phantom 覆盖口子**。

### 为什么在 `RunsService.create()` 拒绝、不在 executor 拒绝

```
POST /runs
  ↓
RunsController.create  (zod 校验)
  ↓
RunsService.create     ← 检查放这里 ✅
  ↓
RunsRepository.createPending   (创建 PENDING 行)
  ↓
executor.start (fire-and-forget)
```

- 放 controller 太浅，绕开 service 的入口（未来如果加 re-run / scheduled run）就漏检
- 放 executor 太深，会产生一个状态为 PENDING/FAILED 的"垃圾 run"残留在列表里
- 放 `RunsService.create()` 是唯一漏斗，一次检查覆盖所有入口、不留半成品

### 不做"运行中 provider 被禁用"的竞态保护

判断：单进程执行器 + 用户手动改 provider 的窗口几乎为零，YAGNI。该边角场景仍走原降级路径（部分样本 `passed:false`），acceptable。

## 改动清单

### 1. `RunsService.create()` 加守门检查

**文件：** `apps/api/src/modules/quality-gate/services/runs.service.ts`

注入 `LlmJudgeService`，在 fetch evaluation 之后、`createPending` 之前加：

```ts
const needsLlmJudge = evaluation.samples.some(
  (s) => s.judgeConfig.kind === "llm-judge",
);
if (needsLlmJudge) {
  const provider = await this.llmJudge.getDecrypted();
  if (!provider?.enabled) {
    throw new BadRequestException(
      "This evaluation requires an LLM judge. " +
        "No enabled LLM judge provider is configured. " +
        "Configure one at Settings → AI Diagnostics.",
    );
  }
}
```

- 错误消息英文（项目惯例：服务端 `BadRequestException` 用英文，前端 toast 直接展示）
- "Settings → AI Diagnostics" 指向 en-US `settings.ai.title = "AI Diagnostics (Global)"`（zh-CN 对应 "AI 智能诊断（全局）"）。当前不做服务端消息 i18n —— 中文 UI 用户看到的英文段会与 zh-CN 标签轻微错位，可接受；如需进一步抹平，单开 i18n 化 PR

### 2. DI 接线

**文件：** `apps/api/src/modules/quality-gate/quality-gate.module.ts`

已确认 `LlmJudgeModule` 已在 `imports`（line 3 + 16）—— `JudgesService` 当前就依赖 `LlmJudgeService`。**本 spec 不改 module 文件**，只需在 `RunsService` 构造函数追加一个 `private readonly llmJudge: LlmJudgeService` 即可（Nest 会自动注入）。

### 3. Phantom schema：删 `judgeModel`

**文件：** `packages/contracts/src/quality-gate/judge-config.ts`

```diff
 const llmJudge = z.object({
   kind: z.literal("llm-judge"),
   rubric: z.string().min(10).max(4000),
   scale: z.enum(["0-1", "0-5", "pass-fail"]),
   passThreshold: z.number().optional(),
-  judgeModel: z.object({ connectionId: z.string() }).optional(),
 });
```

### 4. Phantom plumbing：删 `runJudge` 入参中的 `connectionId`

**文件：** `apps/api/src/modules/quality-gate/judges/llm-judge.ts`

```diff
 export interface LlmJudgeService {
-  runJudge(input: { systemPrompt: string; userPrompt: string; connectionId?: string }): Promise<{
+  runJudge(input: { systemPrompt: string; userPrompt: string }): Promise<{
     content: string;
   }>;
 }
```

```diff
         const resp = await service.runJudge({
           systemPrompt: buildSystemPrompt(config.rubric, config.scale),
           userPrompt: buildUserPrompt(ctx),
-          connectionId: config.judgeModel?.connectionId,
         });
```

**附带：** `llm-judge.ts:6-7` 头部注释当前写的是 "Thin shape from the AI Diagnostics service" —— 这个表述把"裁判 provider"和"AI Diagnostics 功能"两个概念绑死，跟接口本身的通用性矛盾，本次一并改为 "Thin shape over the singleton LLM judge provider. At wiring time the real adapter delegates to `LlmJudgeService.getDecrypted()` + `chatCompletion`."

### 5. 测试

**新增 / 扩展：** `apps/api/test/e2e/quality-gate-runs.e2e-spec.ts`（已有则扩 case，没有则新建）

```ts
describe("POST /api/quality-gate/runs — LLM judge guard", () => {
  it("rejects with 400 when evaluation has llm-judge samples but no provider configured", async () => {
    // arrange: ensure llm_judge_providers is empty
    // arrange: create eval with at least one kind:"llm-judge" sample
    // act: POST /api/quality-gate/runs
    // assert: 400, body.message contains "No enabled LLM judge provider"
  });

  it("rejects with 400 when provider exists but enabled=false", async () => {
    // ensure provider row exists with enabled=false
    // assert: 400 (same path)
  });

  it("succeeds when llm-judge eval has an enabled provider", async () => {
    // upsert enabled provider, post run → 200, status=PENDING
  });

  it("succeeds when eval has only non-llm-judge samples even without provider", async () => {
    // exact-match / contains / regex only eval, no provider → 200
  });
});
```

**契约层 spec：** `packages/contracts/src/quality-gate/__tests__/judge-config.spec.ts` —— 当前 0 处断言 `judgeModel`，无需改。如果新增"`judgeModel` 字段不被 schema 接受（strip 或 reject）"的 case，可选。

### 6. 不需要数据迁移

DB 实际扫描（2026-05-28）：

```
SELECT id, name, jsonb_path_exists(samples, '$[*].judgeConfig.judgeModel') FROM evaluations;
  → 7 rows, all has_judgemodel=f

SELECT id, jsonb_path_exists(evaluation_snapshot, '$.samples[*].judgeConfig.judgeModel') FROM evaluation_runs;
  → 1 row, has_judgemodel=f
```

zod schema 默认 strip 未知字段，即使未来出现脏数据也不会破坏解析。

## 验证计划

1. **手动复现修复前现象**（基线证据）—— 已完成，见 §问题/证据链
2. **改动后 manual smoke：**
   - 关闭 / 删除 LLM judge provider（`DELETE /api/llm-judge/provider`）
   - UI 上 New Run 选 `中文摘要质量` → 提交
   - 期望：toast 弹错"This evaluation requires an LLM judge…"，列表里**不**出现一条 FAILED run
   - 重启 provider → 再 New Run → 期望正常跑、`status=COMPLETED`、`gate_result=PASSED`
3. **自动化：**
   - `pnpm -F @modeldoctor/api test` —— 单元 / 控制器层 spec 全过
   - `pnpm test:e2e:api` —— 新 e2e 4 个 case 全过
   - `pnpm -F @modeldoctor/contracts test` —— judge-config 既有 spec 全过（应零失败，因为没人断言过 `judgeModel`）
   - `pnpm -r lint && pnpm -r type-check`
4. **回归保护：** 4 种 judge 全覆盖 eval（`eval_builtin_qg_demo_zh_customer`，4 样本含 exact-match / contains / regex / llm-judge 各一）跑通

## Acceptance

- [ ] 缺 enabled provider 时，含 llm-judge 的 eval **不能**创建 run（400 + 清晰错误）
- [ ] 含 enabled provider 时，含 llm-judge 的 eval 创建 run 正常
- [ ] 仅含非 llm-judge 样本的 eval 即使无 provider 也能创建 run（不误伤）
- [ ] `judgeModel` 字段从 schema / interface / call site 三处全部移除，全仓 `rg judgeModel` 命中数 = 0
- [ ] 新增 4 个 e2e case 全绿
- [ ] 既有 unit / e2e 套件零回归

## Out of scope（明确拒绝）

- **per-run 裁判选择 UI** —— 业内共识不需要，YAGNI
- **per-eval 裁判 connectionId 覆盖** —— 同上；删 phantom 字段就是这个决定的体现
- **`"AI Diagnostics (Global)"` 改名 / 拆为多张表** —— 它被 alerts.explainer / insights.synthesize / quality-gate.judges 三个模块复用，rename 牵动范围远超当前问题
- **"运行中 provider 被禁用"的竞态保护** —— 单进程执行器窗口几乎为零，YAGNI
- **Web 端 New Run 表单的预防性禁用按钮** —— 后端 400 → toast 链路已足够，UI 层 polish 是另一票
- **其他模块的 phantom schema sweep** —— 本 spec 只清 `judgeModel`，全仓 dead code 审计是另一票
