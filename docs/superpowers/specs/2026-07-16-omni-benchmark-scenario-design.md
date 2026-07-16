# Omni 全模态模型 Benchmark（omni 场景 + vllm-omni-bench 工具）— 设计文档

- 日期：2026-07-16
- 范围：新增「omni 场景」——针对全模态模型(Qwen2.5-Omni / Qwen3-Omni 等)的**语音输出实时性负载压测**,产出 AUDIO_TTFP / AUDIO_RTF 并发曲线、**实时天花板**(RTF<1 的最大并发)和**语音税**(同档 text vs text+audio 的 ΔE2EL)。作为 benchmark 子系统的一个**新 `omni` 场景 + 新 `vllm-omni-bench` 工具**接入,复用现有 K8s Job → S3 执行链路与 `Benchmark` 数据模型。配套扩展:`ModalityCategory` 加 `omni`、官方模板 ×2、Insights omni 评分规则。
- 方法学来源：`~/vllm/repots/experiments/2026-07-15-qwen3-omni-30b-2xa100-{multimodal-function,static-capacity,load-rtf}` 及文章《2026-07-qwen3-omni-realtime》。

---

## 1. 问题与目标

现有 benchmark 工具全部只看 token 指标(TTFT/ITL/tok·s),对 Omni 模型的两条「生死线」无能为力：

- **TTFP**(首个音频包延迟)——决定对话轮转手感;
- **RTF**(实时率 = 生成音频耗时 ÷ 音频播放时长)——RTF<1 才不卡顿,且与音频长度无关、跨轮次可比。

开源工具盘点结论:输入侧多模态压测已有 aiperf(合成图/音输入)、evalscope(VLM),但**音频输出指标目前只有 `vllm-omni bench serve --omni` 提供**(`AUDIO_TTFP` / `AUDIO_RTF` 百分位)。注意 aiperf 文档里的 "RTF" 是 ASR 输入口径,不是生成口径——它不解析响应音频。

目标:用户在 ModelDoctor 里对一个 omni Connection 一键发起压测,一个 run 内完成 `双臂 × 并发档` 扫描,产出:

1. **RTF-并发曲线 + 实时天花板**——回答「这套部署能同时供多少路语音」;
2. **TTFP-并发曲线**——回答「首包手感在多大并发下开始劣化」;
3. **语音税**——回答「开语音输出比纯文本贵多少」(定价/容量输入);
4. **Insights 自动打分**——omni 端点进入覆盖矩阵与健康度体系。

### 实测确认的端点行为(2026-07-16,`http://10.100.121.67:30888` Qwen2.5-Omni-7B)

- 非流式:响应含**两个 `index:0` 的 choice**,一个 `message.content`(文本)、一个 `message.audio.data`(base64 WAV,mono/24kHz/16bit)——音频默认开启;解析音频**必须遍历所有 choices**。
- 流式:chunk 带顶层 `"modality": "text" | "audio"` 字段;先逐 token 文本,后若干大段 base64 WAV(每段自含 RIFF 头)。
- `modalities` 语义坑:`["audio"]` 实际 = text+audio;`["text"]` = 纯文本。

## 2. 已定决策(brainstorm 结论)

| 决策点 | 结论 | 理由 |
|---|---|---|
| v1 测什么 | 负载/RTF(并发扫描) | 文章核心,现有工具做不了;功能门禁后置挂 E2E Smoke,静态容量后置 |
| 压测客户端 | 包官方 `vllm-omni bench serve --omni` | 口径权威、与官方 blog 可比;自建脚本仅作对标参考 |
| 产品挂载 | 新 `ScenarioId "omni"` + 独立 tab | 指标体系与 inference 完全不同;与 agent 场景同模式扩展 |
| sweep 组织 | **一个 run 内扫完 双臂 × 并发档**(方案 A) | 实时天花板/语音税是跨档跨臂派生指标,一 run 一档无载体;修正现状「sweep 只在 guidellm 原生支持时存在」的缺口 |
| sweep 实现位置 | runner 内新增 **omni driver 脚本**,通用 wrapper 零改动 | wrapper 眼里 driver 就是普通工具命令;循环/双臂/逐点容错内聚 |
| Runner 镜像 | `FROM vllm-omni:v0.24.0`(实测节点占 8 GiB)+ COPY wrapper | bench CLI import vllm 内部模块,瘦身需手工摘抄、跨版本脆弱,v1 不做;`IfNotPresent` + 内网 registry 缓解拉取成本 |
| 配套扩展 | `omni` ModalityCategory + 官方模板 ×2 + Insights omni 规则,v1 全做 | 用户明确要求 Test Insights / Test Templates 同步扩展 |
| aiperf 多模态输入臂 | v2 | 复用现有 adapter 测「图/音输入→文本输出」,与本工具互补 |

## 3. 架构与数据流

```
Web (BenchmarkCreatePage / omni tab)
  └─ POST /api/benchmarks {scenario: "omni", tool: "vllm-omni-bench", params, connectionId, templateId?}
      └─ BenchmarkService.create → adapter.paramsSchema 校验 → 落库
      └─ start(): 解密 connection → adapter.buildCommand() → K8s Job
           镜像: md-runner-vllm-omni-bench (FROM vllm-omni:v0.24.0 + runner/)
           └─ 通用 wrapper main.py (不改)
               └─ argv = python -m runner.tools.omni_driver
                    for arm in [text+audio] (+ [text] 若 voiceTax):
                      for c in concurrencyLevels:
                        subprocess: vllm-omni bench serve --omni
                          --base-url $MD_BASE_URL --endpoint /v1/chat/completions
                          --model $MD_MODEL --tokenizer <resolved>
                          --dataset-name random --random-input-len N --random-output-len M
                          --num-prompts max(4, 2*c) --max-concurrency c
                          --num-warmups 1 --ignore-eos
                          --extra-body '{"modalities":["text","audio"]}' | '{"modalities":["text"]}'
                          --percentile-metrics ttft,e2el,audio_ttfp,audio_rtf
                        逐点解析(优先 --save-result JSON,回退 stdout 正则)
                        单点失败 → 记 warning 继续,不整跑作废
                    聚合 → result.json {curve, realtimeCeiling, voiceTax}
               └─ wrapper 照常上传 meta.json / result.json / 日志 → S3
      └─ watcher → ReportLoader → adapter.parseFinalReport() → summaryMetrics
Web 报告页: OmniReport (曲线 + tiles) · Insights: checks/omni.ts 打分
```

鉴权:vllm bench 的 openai 后端从 `OPENAI_API_KEY` env 取 Bearer token;K8s manifest 已把 connection API key 以 Secret 注入,driver 负责把它 export 成 `OPENAI_API_KEY`。

## 4. 组件设计

### 4.1 Tool adapter：`packages/tool-adapters/src/vllm-omni-bench/`

`name: "vllm-omni-bench"`,`scenarios: ["omni"]`。参数 schema(zod):

```ts
{
  concurrencyLevels: number[]     // 默认 [1, 8, 16, 32],1–10 个档,每档 1–512
  inputTokens: number             // 默认 500 (random dataset)
  outputTokens: number            // 默认 300;双臂共用,保证语音税口径(RTF 与音频时长强相关)
  voiceTax: boolean               // 默认 true → 追加 text-only 对照臂,同档同参
  numWarmups: number              // 默认 1
  perPointTimeoutSeconds: number  // 默认 900,单点 bench 子进程超时
  extraArgs?: string              // 透传逃生舱,复用 core/extra-args 校验(不得覆盖受管 flag)
}
```

固化的方法学纪律(不可配,写死在 driver):`--ignore-eos`;`num-prompts = max(4, 2×c)`;双臂 `max_tokens` 恒等;先 warmup 后测量。

`buildCommand`:产出 `python -m runner.tools.omni_driver` + 参数经 `MD_TOOL_PARAMS`(JSON env)下发;`parseFinalReport`:读 result.json → `summaryMetrics`;`readMetric` / `row-descriptors`:见 §5。

### 4.2 Runner driver：`apps/benchmark-runner/runner/tools/omni_driver.py`

- 纯 stdlib + 镜像内已有依赖,不新增 pip 包;
- 逐点解析优先级:`--save-result` JSON(**待验证** vllm-omni 是否继承该 flag)→ 回退 stdout 正则(`Mean TTFT`、`Mean/Median/P99 AUDIO_TTFP`、`Mean/Median/P99 AUDIO_RTF`、`Request throughput`、`Output token throughput`、E2EL 各分位——正则以 `repots` 实验 `obench.sh` 真实输出为 fixture);
- 单点失败(子进程非零退出/超时/解析不出指标):记入 `warnings[]`,该点 `status:"failed"`,继续后续点;全部点失败才整体失败;
- Tokenizer 解析顺序:`MD_TOKENIZER_HF_ID` → 镜像内预置目录 `/tokenizers/<hfId>`;未预置且设置了 `HF_ENDPOINT`(内网镜像源)则透传给 bench 自行下载;两者皆不可用 → 启动即失败并报明确错误(不空转)。

### 4.3 Runner 镜像

- `apps/benchmark-runner/images/vllm-omni-bench.Dockerfile`:`FROM` vllm-omni v0.24.0 基础镜像 + `COPY runner/` + 预置 tokenizer 层(Qwen2.5-Omni-7B、Qwen3-Omni-30B-A3B-Instruct 的 tokenizer 文件,~几十 MB);
- 纳入 `tools/build-runner-images.sh` / `build-base-images.sh` 既有流程;`runner-images.ts` 加 `vllm-omni-bench: "RUNNER_IMAGE_VLLM_OMNI_BENCH"`,env-schema 同步;
- 部署注意:生产集群(67)应从内网 SWR registry 引用,避免 8 GiB 跨网拉取;`imagePullPolicy: IfNotPresent`。

### 4.4 场景注册:`scenarios.ts`

```ts
omni: {
  label: "Omni 实时性",
  description:
    "全模态模型语音输出实时性压测:vllm-omni bench 并发扫描出 AUDIO_TTFP / AUDIO_RTF 曲线、" +
    "实时天花板(RTF<1 最大并发)与语音税(text vs text+audio ΔE2EL)。",
  tools: ["vllm-omni-bench"],
  paramsConstraints: {},
  reportComponent: "OmniReport",
}
```

`ScenarioId` / `scenarioIdSchema` / `reportComponent` 联合类型同步扩展;`assertScenariosInvariant` 既有测试自动覆盖注册一致性。

### 4.5 ModalityCategory 与工具兼容矩阵

- `packages/contracts/src/modality.ts`:enum 加 `"omni"`(排序放 `chat` 之后);
- `category-defaults.ts` 每个工具的 Record 补 `omni` 键:
  - 新工具 `VLLM_OMNI_BENCH_CATEGORY_DEFAULTS`:`omni: {}`(支持),其余 5 类 `{unsupported: true}`;
  - guidellm/evalscope/aiperf:`omni` → 各自 chat 默认值(omni 端点兼容 chat completions,可做纯文本压测,合法且有用);vegeta:`omni: {apiType: "chat"}`;
- Connection 表单 category 下拉自动出现 omni;Discover 自动识别(探测响应 audio choice)为 nice-to-have,v1 手动选。

### 4.6 官方模板(seed)

`apps/api/prisma/seed.ts` 幂等追加,`categories: ["omni"]`:

| id | 名称 | config |
|---|---|---|
| `tpl_official_omni_realtime_standard` | Omni 实时性标准扫描 | scenario omni / tool vllm-omni-bench / levels [1,8,16,32] / 500in/300out / voiceTax on |
| `tpl_official_omni_realtime_quick` | Omni 实时性快检 | levels [1,8] / 500in/300out / voiceTax off |

### 4.7 Insights 评分:`packages/insights-scoring/src/checks/omni.ts`

沿用 `CheckDescriptor` 形状,`scenario: "omni"`,`toolFilter: ["vllm-omni-bench"]`:

| id | axis | direction | metricKind | 权重 |
|---|---|---|---|---|
| `omni.realtime_ceiling` | throughput | higher_is_better | `realtimeCeiling` | 1.0 |
| `omni.audio_ttfp.c1.mean.ms` | responsiveness | lower_is_better | `audioTtfpC1.mean` | 1.0 |
| `omni.audio_ttfp.peak.p99.ms` | tail | lower_is_better | `audioTtfpPeak.p99` | 0.5 |
| `omni.audio_rtf.peak.mean` | smoothness | lower_is_better | `audioRtfPeak.mean` | 1.0 |
| `omni.voice_tax.ms` | efficiency | lower_is_better | `voiceTax.ms` | 0.5 |
| `omni.error_rate` | stability | lower_is_better | `errorRate` | 1.0 |

(axis 均为现有 `RadarAxisId` 枚举值,`contracts/src/insights/check.ts`。)"peak" = 曲线上 RTF 仍 <1 的最大档;findings 文案阈值参考:TTFP p50 <1s 优 / <3s 可 / 以上差;RTF mean <0.7 富余 / <1 达标 / ≥1 超载。默认 `EvaluationProfile` 规则同步补种子。Insights 覆盖矩阵按 scenario 聚合,`omni` 列自动出现,无需矩阵代码改动。

### 4.8 前端

- 路由 `/benchmarks/omni` + sidebar Benchmarks 组新条目(`BenchmarkListShell` 薄包装,照抄 agent);
- 创建表单:`forms/VllmOmniBenchParamsForm.tsx`(档位 chips 输入、in/out tokens、voiceTax 开关),`ToolParamsEditor` 注册分发;
- `OmniReport.tsx`(detail 页按 `reportComponent` 分发):
  - stat tiles:实时天花板 / TTFP@c1(mean) / RTF@peak / 语音税@最高共档;
  - 图 1:RTF-并发曲线(y=1 红线 + 天花板标注;双臂时叠加 text 臂 E2EL 对照);
  - 图 2:TTFP-并发曲线(mean + p99 带);
  - 图 3:语音税柱状(按档);
  - 逐点明细表(含 failed 点 warning 标记);
- Compare / SavedCompare:`row-descriptors` 提供 omni 行描述,跨 run 对比自动可用。

## 5. 数据形状

`result.json` = `summaryMetrics`:

```jsonc
{
  "curve": [
    {
      "arm": "audio",            // "audio" (text+audio) | "text"
      "concurrency": 8,
      "status": "ok",            // "ok" | "failed"
      "reqPerSec": 0.61,
      "outTokPerSec": 139.7,
      "ttftMs":     {"mean": 106, "p50": 98,  "p99": 357},
      "e2elMs":     {"mean": 9800, "p50": 9500, "p99": 12000},
      "audioTtfpMs":{"mean": 890, "p50": 720, "p99": 2100},   // text 臂为 null
      "audioRtf":   {"mean": 0.34, "p50": 0.31, "p99": 0.55}  // text 臂为 null
    }
  ],
  "derived": {
    "realtimeCeiling": 32,        // audio 臂 RTF(mean)<1 的最大档;全部 ≥1 则 0
    "peakConcurrency": 32,        // = realtimeCeiling 对应档(供 *Peak 指标寻址)
    "voiceTaxMsByLevel": {"1": 2100, "8": 3320, "16": 4100, "32": 4800},  // 同档 E2EL(mean) 差
    "voiceTaxMs": 4800            // 最高共档(此例 c=32)的语音税,规则用的标量
  },
  "warnings": ["arm=audio c=64: bench exited 1, point skipped"],
  "toolVersion": "vllm-omni v0.24.0"
}
```

`readMetric` 键:`realtimeCeiling`、`audioTtfpC1.mean`、`audioTtfpPeak.{mean,p50,p99}`、`audioRtfPeak.{mean,p50,p99}`、`voiceTax.ms`、`ttft.{p50,p99}`(audio 臂,peak 档)、`requestsPerSec`、`errorRate`(failed 点数 ÷ 总点数)。

## 6. 错误处理

| 故障 | 行为 |
|---|---|
| 单点 bench 失败/超时/解析失败 | 该点 `status:"failed"` + warning,继续扫描 |
| 全部点失败 | run FAILED,stderr 尾部进 logs |
| tokenizer 不可解析 | 启动即 FAILED,错误信息指明「预置列表 / HF_ENDPOINT」两条出路 |
| connection 带 customHeaders/queryParams | v1 不支持透传给 bench → create 阶段校验拒绝并提示(避免静默丢头) |
| 端点不返回音频(如误选纯文本模型) | AUDIO_* 指标缺失 → 该点解析失败路径,warning 明示「响应无 audio choice」 |

## 7. 测试

- **adapter 单测**(vitest):schema 校验(档位边界、extraArgs 逃生舱)、buildCommand 快照、`parseFinalReport` 用真实 result.json fixture;
- **driver 单测**(pytest):stdout 解析用 `repots` 实验 obench 真实输出 fixture;单点失败继续、全失败退出码、tokenizer 解析顺序、双臂 num-prompts 规则;
- **注册一致性**:`assertScenariosInvariant` 既有 spec 自动覆盖;category-defaults 的 `satisfies` 编译期兜底;
- **e2e 冒烟**(手动/CI 可选):打 `http://10.100.121.67:30888` Qwen2.5-Omni-7B,quick 模板跑通全链路。

## 8. 待验证 / 开放问题

1. `vllm-omni bench serve` 是否支持 `--save-result`(vllm 上游有);不支持则 stdout 正则为唯一路径——fixture 已备;
2. 8 GiB 基础镜像进 ghcr 多架构流程的成本;生产走内网 SWR 的引用方式;
3. bench 对自定义 header 的支持(上游 `--header` flag 版本差异)→ 决定 §6 中 customHeaders 校验能否放开;
4. Discover 自动识别 omni category(探测 audio choice)——v1.x;
5. `realtimeCeiling` 以 mean RTF 为基准(与文章口径一致);是否提供 p99 严格口径开关,看使用反馈。

## 9. 后续版本(不在本 spec 范围)

- **v2 输入侧臂**:aiperf 标记 omni 兼容,测「图/音输入 → 文本输出」负载;
- **功能门禁**:E2E Smoke 加 omni probe(每模态一发 + audio choice 可解码校验),对应文章 EXP-1;
- **静态容量**:读启动日志(KV tokens / Maximum concurrency)的轻量场景,对应 EXP-2;
- **WS 实时链路**:`/v1/realtime`、`/v1/audio/speech/stream` 的 TTFP 压测(文章 C6,协议未定型,观望)。
