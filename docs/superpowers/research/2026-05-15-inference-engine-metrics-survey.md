# 推理引擎与可观测组件 Prometheus 指标调研

> **目的**:在编写 ModelDoctor 内置 PrometheusRule (recording rules + alert rules) 之前,先对各引擎/各版本暴露的原始指标做一次实证扫描,产出引擎到 `modeldoctor:*` 归一命名空间的映射表。后续 yaml 才不是猜的。
>
> **覆盖范围**: vLLM V0/V1、SGLang (pre-v0.5.4 / v0.5.4+)、TGI、Higress AI Statistics、DCGM、Huawei NPU Exporter。
>
> **作者**: ModelDoctor team
> **日期**: 2026-05-15

---

## 0. 调研约束与方法

- 调研以**官方文档 + 引擎源码**为准;Grafana 第三方 dashboard 仅用于交叉验证。
- **设计原则(版本即引擎)**:同一引擎不同 major 版本指标名变更是常态。我们**不在 PromQL 层做跨版本适配**(不写 `or`、不做 presence-of-metric 检测、不写 `label_replace` 桥接)。我们把每个 (engine, major version) **视为独立的引擎类型**——例如 `vllm-v0` 和 `vllm-v1` 是两个 engine,`sglang-legacy` 和 `sglang-v0.5.4+` 是两个 engine。
  - 用户在 ModelDoctor connection 上声明引擎类型 + 版本时,我们 apply 对应那一份 PrometheusRule。
  - 一个引擎类型 = 一份 recording rule yaml + 一份 alert rule yaml,各自独立。
  - 新增版本 = 新增引擎类型 + 新增 yaml,不改既有文件。
- 指标分类标尺(全文统一):
  - **R** (Request lifecycle): 请求计数、TTFT、TPOT/ITL、E2E latency、队列等
  - **T** (Throughput): tokens/sec, requests/sec
  - **C** (Capacity/Cache): KV cache 利用率、prefix cache 命中、batch size
  - **G** (Gateway/Routing): 网关侧路由、限流、租户维度
  - **H** (Hardware): GPU/NPU 利用率、显存、温度、功率
- 不在本调研范围:Triton Server (#TODO 后续单独章节)、TensorRT-LLM Backend、LMDeploy。

---

## 1. vLLM

### 1.1 vLLM V0 (0.5.x – 0.6.x,legacy engine)

V0 是 vLLM 的"旧"引擎,2026 年仍是 stable 默认在 ≤0.6.x。指标统一前缀 `vllm:`,所有 histogram 用 `_bucket`/`_sum`/`_count` 三件套。

**Request lifecycle (R):**

| 指标 | 类型 | 描述 | 关键 label |
|---|---|---|---|
| `vllm:num_requests_running` | Gauge | 正在 decoding 的请求数 | `model_name` |
| `vllm:num_requests_waiting` | Gauge | 在 waiting queue 的请求数 | `model_name` |
| `vllm:num_requests_swapped` | Gauge | 被 swap 出去的请求数 | `model_name` |
| `vllm:time_to_first_token_seconds` | Histogram | TTFT (含队列+prefill) | `model_name` |
| `vllm:time_per_output_token_seconds` | Histogram | 每个输出 token 的间隔 (ITL/TPOT) | `model_name` |
| `vllm:e2e_request_latency_seconds` | Histogram | 端到端 latency | `model_name` |
| `vllm:request_queue_time_seconds` | Histogram | 仅排队时间 | `model_name` |
| `vllm:request_prefill_time_seconds` | Histogram | 仅 prefill 时间 | `model_name` |
| `vllm:request_decode_time_seconds` | Histogram | 仅 decode 时间 | `model_name` |
| `vllm:request_inference_time_seconds` | Histogram | prefill+decode | `model_name` |

**Throughput (T):**

| 指标 | 类型 | 描述 |
|---|---|---|
| `vllm:prompt_tokens_total` | Counter | 累计 prompt tokens |
| `vllm:generation_tokens_total` | Counter | 累计 generation tokens |
| `vllm:request_prompt_tokens` | Histogram | 单请求 prompt token 数分布 |
| `vllm:request_generation_tokens` | Histogram | 单请求 generation token 数分布 |
| `vllm:request_params_n` | Histogram | n 参数分布 |
| `vllm:request_params_best_of` | Histogram | best_of 参数分布 |

**Capacity/Cache (C):**

| 指标 | 类型 | 描述 |
|---|---|---|
| `vllm:gpu_cache_usage_perc` | Gauge | GPU KV cache 占用率 0-1 |
| `vllm:cpu_cache_usage_perc` | Gauge | CPU KV cache (swap) 占用率 |
| `vllm:cpu_prefix_cache_hit_rate` | Gauge | CPU prefix cache 命中率 (实验性) |
| `vllm:gpu_prefix_cache_hit_rate` | Gauge | GPU prefix cache 命中率 (实验性) |
| `vllm:num_preemptions_total` | Counter | 因显存不足触发的请求 preemption 次数 |

**LoRA / 其他:**

| 指标 | 类型 |
|---|---|
| `vllm:lora_requests_info` | Gauge | LoRA adapter 在用统计 |
| `vllm:request_success_total` | Counter | 成功结束的请求数 (按 finish_reason 拆) |

### 1.2 vLLM V1 (0.7+ 默认,2025-2026 主线)

V1 全面重构,**多个指标改名 / 重命名 label / 拆分实现**。直接套 V0 的 query 会拿到 0 值,这是过去 6 个月 vLLM 用户报错最多的来源。

**已知 breaking changes (V0 → V1):**

| V0 指标 | V1 替代 | 说明 |
|---|---|---|
| `vllm:gpu_cache_usage_perc` | `vllm:kv_cache_usage_perc` | 改名,去掉 GPU/CPU 区分;V1 KV cache 抽象统一 |
| `vllm:cpu_cache_usage_perc` | — | 在 V1 中去除 (swap 模式不同) |
| `vllm:time_per_output_token_seconds` | `vllm:inter_token_latency_seconds` | 改名,语义不变 (ITL) |
| `vllm:cpu_prefix_cache_hit_rate` | — | 删除 |
| `vllm:gpu_prefix_cache_hit_rate` | `vllm:prefix_cache_queries` + `vllm:prefix_cache_hits` (counters) | 改为两条 counter,命中率必须用 `rate(hits) / rate(queries)` 推导 |

**V1 新增/统一指标:**

| 指标 | 类型 | 备注 |
|---|---|---|
| `vllm:request_queue_time_seconds` | Histogram | V1 起加 `engine` label |
| `vllm:request_inference_time_seconds` | Histogram | V1 |
| `vllm:request_prefill_time_seconds` | Histogram | V1 |
| `vllm:request_decode_time_seconds` | Histogram | V1 |
| `vllm:cache_config_info` | Gauge | KV cache 配置信息 info-style |

**V1 label 重要变化:** 所有 V1 metric 强制带 `model_name` 和 `engine` label。

### 1.3 vLLM 视作两个独立引擎类型

```
engine type   |  适用 vLLM 版本                |  对应 PrometheusRule 文件
--------------+--------------------------------+----------------------------
vllm-v0       |  0.5.x – 0.6.x (legacy default) |  rules/vllm-v0.yaml
vllm-v1       |  0.7.x – 0.8.x+ (V1 default)    |  rules/vllm-v1.yaml
```

- ModelDoctor connection 创建时,用户在引擎下拉里直接选 `vllm-v0` 或 `vllm-v1`,没有"自动识别"选项。
- 两份 yaml 各写各的,不复用、不嵌套、不写 `or`。后续如果出 V2,新增 `vllm-v2.yaml`,前两份完全不动。
- 用户从 0.6 升级到 0.7,操作流程是:在 connection 上把引擎类型从 `vllm-v0` 改为 `vllm-v1`,ModelDoctor 重新 apply 对应 PrometheusRule。

---

## 2. SGLang

### 2.1 v0.4.x – v0.5.3 (legacy,`sglang:` 冒号前缀)

通过 `--enable-metrics` 启用,默认端点 `:30000/metrics`。

**Engine 指标:**

| 指标 | 类型 | 描述 |
|---|---|---|
| `sglang:prompt_tokens_total` | Counter | 累计 prefill input tokens |
| `sglang:generation_tokens_total` | Counter | 累计 generation tokens |
| `sglang:cached_tokens_total` | Counter | prefix cache 命中 tokens |
| `sglang:gen_throughput` | Gauge | 当前生成速率 (tokens/sec) |
| `sglang:num_running_reqs` | Gauge | 正在处理请求数 |
| `sglang:num_queue_reqs` | Gauge | 排队请求数 |
| `sglang:num_used_tokens` | Gauge | KV cache 已用 tokens |
| `sglang:cache_hit_rate` | Gauge | prefix cache 命中率 0-1 |
| `sglang:token_usage` | Gauge | KV cache 利用率 0-1 |
| `sglang:time_to_first_token_seconds` | Histogram | TTFT |
| `sglang:e2e_request_latency_seconds` | Histogram | E2E latency |
| `sglang:time_per_output_token_seconds` | Histogram | ITL |
| `sglang:func_latency_seconds` | Histogram | 内部函数耗时 (调试用) |

**Router 指标(独立服务 `sgl-router`):**

| 指标 | 类型 |
|---|---|
| `sgl_router_requests_total` | Counter (by route, method) |
| `sgl_router_processed_requests_total` | Counter (by worker) |
| `sgl_router_active_workers` | Gauge |
| `sgl_router_running_requests` | Gauge (per worker) |
| `sgl_router_worker_health` | Gauge |
| `sgl_router_cache_hits_total` | Counter |
| `sgl_router_cache_misses_total` | Counter |
| `sgl_router_generate_duration_seconds` | Histogram |

### 2.2 v0.5.4+ Breaking Change → 视作独立引擎类型

**前缀从 `sglang:` 改为 `sglang_`** (下划线)。

```
sglang:num_running_reqs   →   sglang_num_running_reqs
sglang:e2e_request_latency_seconds   →   sglang_e2e_request_latency_seconds
```

```
engine type            |  适用版本             |  PrometheusRule 文件
-----------------------+----------------------+-----------------------------
sglang-legacy          |  v0.4.x – v0.5.3     |  rules/sglang-legacy.yaml
sglang-v0.5.4plus      |  v0.5.4+             |  rules/sglang-v0.5.4plus.yaml
```

两份 yaml 各自独立,不做 `label_replace` 跨版本适配。

### 2.3 SGLang 待确认项

- `phase` label 在哪些版本起出现 (用于 prefill/decode 区分),需源码确认。
- MFU (Model FLOPs Utilization) 指标尚未在主线 release(issue #19286 开放中),不纳入本期归一化。

---

## 3. TGI (Text Generation Inference)

HuggingFace TGI 1.x → 2.x,默认 `/metrics`。

| 指标 | 类型 | 描述 |
|---|---|---|
| `tgi_request_count` | Counter | 请求总数 |
| `tgi_request_success` | Counter | 成功请求数 |
| `tgi_request_failure` | Counter | 失败请求数 |
| `tgi_request_duration` | Histogram | E2E 请求耗时 (秒) |
| `tgi_request_queue_duration` | Histogram | 排队耗时 |
| `tgi_request_inference_duration` | Histogram | 推理(prefill+decode)耗时 |
| `tgi_request_mean_time_per_token_duration` | Histogram | 平均每 token 耗时 (~ TPOT) |
| `tgi_request_input_length` | Histogram | input token 数 |
| `tgi_request_generated_tokens` | Histogram | 生成 token 数 |
| `tgi_request_max_new_tokens` | Histogram | max_new_tokens 参数分布 |
| `tgi_batch_current_size` | Gauge | 当前 batch 大小 |
| `tgi_batch_next_size` | Histogram | 下一批 batch 大小分布 |
| `tgi_queue_size` | Gauge | 队列长度 |
| `tgi_batch_forward_duration` | Histogram | 单次 forward 耗时 (按 stage label) |
| `tgi_batch_inference_duration` | Histogram | 单次推理耗时 |
| `tgi_batch_inference_count` | Counter | 推理批次计数 |

**TGI 缺口:**
- **没有专门的 TTFT 指标**:必须通过 `tgi_request_queue_duration + tgi_batch_forward_duration{stage="prefill"}` 推算。这是归一化里的一个特殊 case。
- 不暴露 KV cache 利用率 (TGI 内部 PagedAttention 是黑盒)。

---

## 4. Higress (网关层)

Higress AI Statistics WASM plugin (v1.x),为 LLM 流量提供 token 级监控。

**全部 6 个指标,共同 label 维度: `ai_route`, `ai_cluster`, `ai_model`, `ai_consumer`:**

| 指标 | 类型 | 描述 |
|---|---|---|
| `route_upstream_model_consumer_metric_input_token` | Counter | 累计 input tokens |
| `route_upstream_model_consumer_metric_output_token` | Counter | 累计 output tokens |
| `route_upstream_model_consumer_metric_llm_service_duration` | Counter (sum-like) | 累计 LLM 服务时长 (μs/ms,需确认) |
| `route_upstream_model_consumer_metric_llm_duration_count` | Counter | 服务调用次数 (与 duration 配对算平均) |
| `route_upstream_model_consumer_metric_llm_first_token_duration` | Counter (sum-like) | 累计 TTFT 时长 |
| `route_upstream_model_consumer_metric_llm_stream_duration_count` | Counter | streaming 调用次数 |

**关键含义:**
- `ai_consumer` 是租户/API key 级维度——这是 Higress 区别于其他网关的核心价值。
- 没有 histogram,只有 sum/count 对。要算 P99 latency **不可能从 Higress 单独得到**,只能从上游引擎拿。Higress 的指标补充的是"路由维度的总量与平均",不是"分布"。
- 配额、限流相关指标在另一个 plugin (`quota`),本调研不展开。

**与引擎指标的角色分工:**
- 引擎维度 (vLLM/SGLang) 知道 GPU 内部发生什么,但不知道是哪个 `ai_consumer` 触发的。
- Higress 知道 route/consumer,但不知道 KV cache 是否爆了。
- → 跨维度排障必须依赖 `ai_model` (Higress) ↔ `model_name` (引擎) 做 label join。

---

## 5. DCGM (NVIDIA GPU)

NVIDIA DCGM Exporter,事实标准。所有指标前缀 `DCGM_FI_*`,label `gpu`, `UUID`, `device`, `Hostname`, `instance`, `pod`, `namespace` 等。

| 指标 | 类型 | 描述 |
|---|---|---|
| `DCGM_FI_DEV_GPU_UTIL` | Gauge | GPU 利用率 (0-100) |
| `DCGM_FI_DEV_MEM_COPY_UTIL` | Gauge | 显存拷贝利用率 |
| `DCGM_FI_DEV_FB_USED` | Gauge | 已用显存 (MiB) |
| `DCGM_FI_DEV_FB_FREE` | Gauge | 空闲显存 (MiB) |
| `DCGM_FI_DEV_FB_TOTAL` | Gauge | 总显存 (MiB) |
| `DCGM_FI_DEV_GPU_TEMP` | Gauge | GPU 温度 (°C) |
| `DCGM_FI_DEV_POWER_USAGE` | Gauge | 功率 (W) |
| `DCGM_FI_DEV_SM_CLOCK` | Gauge | SM 频率 (MHz) |
| `DCGM_FI_DEV_MEM_CLOCK` | Gauge | 显存频率 (MHz) |
| `DCGM_FI_DEV_NVLINK_BANDWIDTH_TOTAL` | Counter | NVLink 累计带宽 |
| `DCGM_FI_PROF_PIPE_TENSOR_ACTIVE` | Gauge | Tensor Core 活跃率 (DCGM Profiler,可选) |
| `DCGM_FI_PROF_GR_ENGINE_ACTIVE` | Gauge | Graphics Engine 活跃率 |
| `DCGM_FI_PROF_DRAM_ACTIVE` | Gauge | DRAM 活跃率 |
| `DCGM_FI_DEV_XID_ERRORS` | Counter | XID 错误码 |

**模板告警最常用的子集:**`GPU_UTIL`, `FB_USED/FB_TOTAL`, `GPU_TEMP`, `POWER_USAGE`, `XID_ERRORS` —— 这 5 个进归一化。Profiler metrics (`PROF_*`) 默认关闭,不纳入必选。

---

## 6. Huawei NPU Exporter (Ascend)

国产化场景必备。npu-exporter 共暴露 **73 个指标**(官方未公开完整 enumeration),按 collector 拆分。本节列出 ModelDoctor 必备子集 + 完整 collector 分类。

**Collector 分类(完整覆盖面):**

| Collector | 覆盖范围 |
|---|---|
| `BaseInfoCollector` | chip 基本信息 (id, name, model) |
| `DdrCollector` | DDR 内存 |
| `HbmCollector` | HBM 高带宽内存 |
| `HccsCollector` | HCCS 缓存一致性总线 |
| `NetworkCollector` | 网络口 |
| `OpticalCollector` | 光模块 |
| `PcieCollector` | PCIe 链路 |
| `RoceCollector` | RoCE / RDMA |
| `SioCollector` | 串行 I/O |
| `VersionCollector` | 固件版本 |
| `VnpuCollector` | 虚拟 NPU |

**已确认的核心 chip 级指标(模板告警子集):**

| 指标 | 类型 | 描述 | 关键 label |
|---|---|---|---|
| `npu_chip_info_name` | Info | 名称、id、model_name、vdie_id, pcie_bus_info | `id`, `model_name` |
| `npu_chip_info_health_status` | Gauge | 健康 (1) / 不健康 (0) | `id`, `model_name` |
| `npu_chip_info_power` | Gauge | 功耗 (W) | `id`, `model_name` |
| `npu_chip_info_temperature` | Gauge | 温度 (°C) | `id`, `model_name` |
| `npu_chip_info_utilization` | Gauge | AI Core 使用率 (%) | `id`, `model_name` |
| `npu_chip_info_vector_utilization` | Gauge | AI Vector 使用率 (%) | `id`, `model_name` |
| `npu_chip_info_used_memory` | Gauge | DDR 已用 (MB) | `id`, `model_name` |
| `npu_chip_info_total_memory` | Gauge | DDR 总量 (MB) | `id`, `model_name` |
| `machine_npu_nums` | Gauge | 机器上 NPU 数量 | — |
| `npu_chip_info_error_code` | Gauge | 错误码 (0=正常) | `id`, `model_name` |

**通用 pod-level label**(所有指标都带): `container_name`, `namespace`, `pod_name`。

**⚠️ 待补充完整的指标段(本期归一化暂不覆盖,留待后续 PR):**
- `npu_chip_info_hbm_used_memory` / `npu_chip_info_hbm_capacity` (HBM 使用,910B 用)
- `npu_chip_info_aicore_current_freq` (AICore 频率)
- HCCS / RoCE / 光模块 误码率(链路诊断用)
- 上述指标存在于 npu-exporter 代码中,但官方 Cloud 文档只列了 chip-level 基础项。**建议落地后用真实集群的 `/metrics` dump 补全本表**。

---

## 7. 归一化:`modeldoctor:*` 命名空间映射

设计原则:
- **统一前缀 `modeldoctor:`**,后接维度 (`request`, `cache`, `gateway`, `accelerator`),再接具体指标。
- 所有归一化指标都带 `engine` (= engine type slug,如 `vllm-v1`)、`model_name` 两个核心 label。
- 仪表盘和告警**只查询归一化指标**,不直接查 `vllm:*` / `sglang:*`。
- **每张表按 engine type 一行展开**,每个 cell 是这个 engine type 下的具体 source metric 或表达式。空 cell 表示该 engine 暂不支持该归一化指标(留空,而非跨版本拼接)。

### 7.1 Request lifecycle 归一化

| engine type | `request:running` | `request:waiting` | `request:ttft_seconds` | `request:itl_seconds` | `request:e2e_seconds` | `request:queue_seconds` | `request:preempted_total` |
|---|---|---|---|---|---|---|---|
| `vllm-v0` | `vllm:num_requests_running` | `vllm:num_requests_waiting` | `vllm:time_to_first_token_seconds` | `vllm:time_per_output_token_seconds` | `vllm:e2e_request_latency_seconds` | `vllm:request_queue_time_seconds` | `vllm:num_preemptions_total` |
| `vllm-v1` | `vllm:num_requests_running` | `vllm:num_requests_waiting` | `vllm:time_to_first_token_seconds` | `vllm:inter_token_latency_seconds` | `vllm:e2e_request_latency_seconds` | `vllm:request_queue_time_seconds` | `vllm:num_preemptions_total` |
| `sglang-legacy` | `sglang:num_running_reqs` | `sglang:num_queue_reqs` | `sglang:time_to_first_token_seconds` | `sglang:time_per_output_token_seconds` | `sglang:e2e_request_latency_seconds` | — | — |
| `sglang-v0.5.4plus` | `sglang_num_running_reqs` | `sglang_num_queue_reqs` | `sglang_time_to_first_token_seconds` | `sglang_time_per_output_token_seconds` | `sglang_e2e_request_latency_seconds` | — | — |
| `tgi` | `tgi_batch_current_size` | `tgi_queue_size` | `tgi_request_queue_duration + tgi_batch_forward_duration{stage="prefill"}` (derived) | `tgi_request_mean_time_per_token_duration` | `tgi_request_duration` | `tgi_request_queue_duration` | — |

### 7.2 Throughput 归一化

| engine type | `throughput:prompt_tokens_total` | `throughput:generation_tokens_total` | `throughput:generation_rate_tps` |
|---|---|---|---|
| `vllm-v0` | `vllm:prompt_tokens_total` | `vllm:generation_tokens_total` | `rate(vllm:generation_tokens_total[1m])` |
| `vllm-v1` | `vllm:prompt_tokens_total` | `vllm:generation_tokens_total` | `rate(vllm:generation_tokens_total[1m])` |
| `sglang-legacy` | `sglang:prompt_tokens_total` | `sglang:generation_tokens_total` | `sglang:gen_throughput` |
| `sglang-v0.5.4plus` | `sglang_prompt_tokens_total` | `sglang_generation_tokens_total` | `sglang_gen_throughput` |
| `tgi` | derived from `tgi_request_input_length` (sum) | derived from `tgi_request_generated_tokens` (sum) | `rate(...generated_tokens_sum[1m])` |

### 7.3 Cache / Capacity 归一化

| engine type | `cache:kv_usage_ratio` | `cache:prefix_hit_ratio` | `cache:swap_usage_ratio` |
|---|---|---|---|
| `vllm-v0` | `vllm:gpu_cache_usage_perc` | `vllm:gpu_prefix_cache_hit_rate` | `vllm:cpu_cache_usage_perc` |
| `vllm-v1` | `vllm:kv_cache_usage_perc` | `rate(vllm:prefix_cache_hits[1m]) / rate(vllm:prefix_cache_queries[1m])` | — |
| `sglang-legacy` | `sglang:token_usage` | `sglang:cache_hit_rate` | — |
| `sglang-v0.5.4plus` | `sglang_token_usage` | `sglang_cache_hit_rate` | — |
| `tgi` | — (黑盒) | — | — |

### 7.4 Gateway 归一化(Higress)

| `modeldoctor:gateway:*` | 来源 (Higress label 透传: `ai_route`, `ai_consumer`, `ai_model`) |
|---|---|
| `modeldoctor:gateway:input_tokens_total` | `route_upstream_model_consumer_metric_input_token` |
| `modeldoctor:gateway:output_tokens_total` | `route_upstream_model_consumer_metric_output_token` |
| `modeldoctor:gateway:llm_duration_total_seconds` | `route_upstream_model_consumer_metric_llm_service_duration` (单位需确认,可能需要 `/1e6`) |
| `modeldoctor:gateway:llm_request_count_total` | `route_upstream_model_consumer_metric_llm_duration_count` |
| `modeldoctor:gateway:ttft_total_seconds` | `route_upstream_model_consumer_metric_llm_first_token_duration` |
| `modeldoctor:gateway:streaming_count_total` | `route_upstream_model_consumer_metric_llm_stream_duration_count` |

**注意**: Higress 无 histogram,所以不能给 `gateway:ttft_seconds_histogram`。算 avg TTFT 用 `rate(ttft_total_seconds) / rate(llm_request_count_total)`,P99 必须从引擎侧拿。

### 7.5 Accelerator 归一化(GPU+NPU)

设计:**accelerator namespace 同时覆盖 NVIDIA 和 Ascend**,通过 label `device_kind={nvidia|ascend}` 区分。归一化后告警规则不再需要分两份。

| `modeldoctor:accelerator:*` | NVIDIA (DCGM) | Ascend (npu-exporter) |
|---|---|---|
| `modeldoctor:accelerator:utilization_ratio` (0-1) | `DCGM_FI_DEV_GPU_UTIL / 100` | `npu_chip_info_utilization / 100` |
| `modeldoctor:accelerator:memory_used_bytes` | `DCGM_FI_DEV_FB_USED * 1024 * 1024` | `npu_chip_info_used_memory * 1024 * 1024` |
| `modeldoctor:accelerator:memory_total_bytes` | `DCGM_FI_DEV_FB_TOTAL * 1024 * 1024` | `npu_chip_info_total_memory * 1024 * 1024` |
| `modeldoctor:accelerator:memory_usage_ratio` (0-1) | derived | derived |
| `modeldoctor:accelerator:temperature_celsius` | `DCGM_FI_DEV_GPU_TEMP` | `npu_chip_info_temperature` |
| `modeldoctor:accelerator:power_watts` | `DCGM_FI_DEV_POWER_USAGE` | `npu_chip_info_power` |
| `modeldoctor:accelerator:health_status` (1=healthy) | derived from `DCGM_FI_DEV_XID_ERRORS == 0` | `npu_chip_info_health_status` |
| `modeldoctor:accelerator:error_total` | `DCGM_FI_DEV_XID_ERRORS` | `npu_chip_info_error_code != 0` |

---

## 8. 5 个真实故障场景 → 归一化指标依赖矩阵

我们之前对齐过的 5 个典型场景:

### 场景 A: TTFT 抖动 + KV 爆 → 用户感知到的"卡顿"

依赖:
- `modeldoctor:request:ttft_seconds` (P99 突增)
- `modeldoctor:cache:kv_usage_ratio` > 0.9 持续
- `modeldoctor:request:waiting` 队列堆积
- `modeldoctor:request:preempted_total` 计数增加

### 场景 B: prefix cache miss 飙升 → 后续优化点

依赖:
- `modeldoctor:cache:prefix_hit_ratio` 显著下降
- 配合 `modeldoctor:gateway:input_tokens_total` 看是否 input 模式变化

### 场景 C: 网关侧某 consumer 异常占用资源 → 多租户隔离

依赖(全部 Higress 侧,因为引擎不知道 consumer):
- `rate(modeldoctor:gateway:input_tokens_total)` by `ai_consumer`
- `rate(modeldoctor:gateway:output_tokens_total)` by `ai_consumer`
- 联动引擎: `modeldoctor:request:running` 同时升高确认相关性

### 场景 D: GPU/NPU 物理异常 (XID error, NPU error_code)

依赖:
- `modeldoctor:accelerator:error_total` 增长 + `health_status == 0`
- 配合 `modeldoctor:accelerator:temperature_celsius` / `power_watts` 看是否过热触发

### 场景 E: 引擎 hang / OOM 退化

依赖:
- `modeldoctor:request:running` 长时间 == 0 (引擎 hang)
- 或 `modeldoctor:request:preempted_total` 持续高位
- 配合 `modeldoctor:accelerator:memory_usage_ratio` > 0.95

→ 这 5 个场景都能用归一化指标表达,不需要 query 原始引擎指标。**第二步的 alert rules 直接基于本表落地。**

---

## 9. 未覆盖 / 后续

- **Triton Server**: 待加(大量国内用户用 Triton 跑 TensorRT-LLM,指标体系完全不同),将作为独立 engine type `triton`。
- **LMDeploy**: 待加,独立 engine type `lmdeploy`。
- **TGI 2.x → 3.x**: 2026 年新版若有指标变更,将拆为 `tgi-v2` / `tgi-v3` 独立 engine type。
- **NPU Exporter 完整指标 enumeration**: 等真实 Ascend 集群接入后,做一次 `/metrics` dump 补全本表 §6。
- **`engine` label 注入方式**: 每份 PrometheusRule 在 recording rule expression 里**硬编码** `engine` label (e.g. `labels: { engine: "vllm-v1" }`),不依赖引擎自己暴露 build info。哪份 rule 文件被 apply,哪个 engine label 就被产出,语义自洽。
- **labels 不一致风险**: vLLM `model_name`、SGLang 暂无 model label(单进程绑定单模型,需用 `instance`)、TGI `model_id`。各 engine type 自己的 recording rule 在产出 `modeldoctor:*` 时,用 `label_replace` 把源 label 改名到统一的 `model_name`——这是 engine-internal 的转换,不是跨版本适配。

---

## 10. Sources

- vLLM V0/V1: https://github.com/vllm-project/vllm — `vllm/engine/metrics.py`、`vllm/v1/metrics/loggers.py`
- SGLang Production Metrics: https://docs.sglang.ai/references/production_metrics.html
- SGLang Prometheus Metrics Guide: https://kuncoro.io/blog/sglang-prometheus-metrics-guide/
- TGI Metrics: HuggingFace TGI repo `router/src/server.rs`
- Higress AI Statistics: https://higress.cn (plugins/wasm-go/extensions/ai-statistics)
- DCGM Exporter: https://github.com/NVIDIA/dcgm-exporter
- Huawei NPU Exporter: https://support.huaweicloud.com/intl/en-us/usermanual-cce/cce_10_0970.html ; https://pkg.go.dev/github.com/professorshandian/npu-exporter/collector/metrics

---

**Review checklist (留给 reviewer):**
- [ ] §0 "版本即引擎"原则是否接受?后续 ModelDoctor connection UI 上引擎下拉就长这样:`vllm-v0` / `vllm-v1` / `sglang-legacy` / `sglang-v0.5.4plus` / `tgi` / ...
- [ ] §1 vLLM 拆 `vllm-v0` + `vllm-v1` 两个引擎类型,是否覆盖你团队实际跑的版本?
- [ ] §2 SGLang 拆 `sglang-legacy` + `sglang-v0.5.4plus` 两个引擎类型,是否合适?
- [ ] §3 TGI 没有 TTFT 原生指标,通过 queue + prefill duration 推算可接受吗?
- [ ] §4 Higress label 维度 `ai_consumer` 是否要在 ModelDoctor connection 上做对齐?
- [ ] §6 NPU 部分缺 HBM、AICore 频率等高阶指标,是否本期推迟到落地后用真实 dump 补全?
- [ ] §7 归一化映射表是否完整?(每个 engine type 一行)
- [ ] §7.5 `modeldoctor:accelerator:*` 同时覆盖 NVIDIA 和 Ascend (这是硬件层,不是引擎层,所以不拆 engine type,而是用 `device_kind` label 区分),这个设计是否接受?
- [ ] §8 5 个场景的依赖矩阵是否完整?有遗漏的场景吗?
