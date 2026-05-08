import type { EngineMeta, EngineRecipe, ModelEntry, RecipeStatus } from "./types";

// ---------------------------------------------------------------------------
// Static metadata
//
// NOTE — UI chrome (page title, tab labels, table headers, drawer field
// labels) flows through i18n at apps/web/src/locales/*/deployment-recipes.json.
// The descriptive payload below (model meta, tooltip, notes, resource, params)
// is intentionally zh-CN-first for V1, mirroring the AI-narrative convention
// in CLAUDE.md ("AI narrative is zh-CN only for V1"). When we localise the
// recipe payload, lift these strings into the locale bundle keyed by the
// model id + engine id.
// ---------------------------------------------------------------------------

export const ENGINES: EngineMeta[] = [
  { id: "vllm", name: "vLLM", vendor: "UC Berkeley" },
  { id: "sglang", name: "SGLang", vendor: "LMSYS" },
  { id: "trtllm", name: "TensorRT-LLM", vendor: "NVIDIA" },
  { id: "mindie", name: "MindIE", vendor: "Huawei Ascend" },
  { id: "lmdeploy", name: "LMDeploy", vendor: "InternLM" },
  { id: "tgi", name: "TGI", vendor: "HuggingFace" },
  { id: "tei", name: "TEI", vendor: "HuggingFace" },
  { id: "infinity", name: "Infinity", vendor: "Michael Feil" },
  { id: "llamacpp", name: "llama.cpp", vendor: "ggml.ai" },
  { id: "comfyui", name: "ComfyUI / Diffusers", vendor: "comfyanonymous · HF" },
];

// ---------------------------------------------------------------------------
// Recipe builders
// ---------------------------------------------------------------------------

const native = (r: Omit<EngineRecipe, "status">): EngineRecipe => ({ status: "native", ...r });
const partial = (r: Omit<EngineRecipe, "status">): EngineRecipe => ({ status: "partial", ...r });

// Common HF cache volume snippet — single source of truth.
const HF_VOL = "-v $HOME/.cache/huggingface:/root/.cache/huggingface";

// ---------------------------------------------------------------------------
// MODELS
// ---------------------------------------------------------------------------

export const MODELS: ModelEntry[] = [
  // =========================================================================
  // A. 稠密 LLM
  // =========================================================================
  {
    id: "llama-3",
    name: "Llama 3.1 / 3.3 (8B/70B)",
    category: "dense",
    meta: "Meta · 通用基线",
    engines: {
      vllm: native({
        minVersion: "0.5.4",
        image: "vllm/vllm-openai:v0.7.3",
        tooltip: "vLLM ≥ 0.5.4,70B 推荐 TP=4",
        command: `docker run --gpus all --shm-size 16g \\
  -p 8000:8000 ${HF_VOL} \\
  vllm/vllm-openai:v0.7.3 \\
  --model meta-llama/Llama-3.3-70B-Instruct \\
  --tensor-parallel-size 4 \\
  --max-model-len 32768 \\
  --gpu-memory-utilization 0.92`,
        params: [
          { key: "--tensor-parallel-size", value: "4", desc: "70B 推荐 4 卡 TP" },
          {
            key: "--max-model-len",
            value: "32768",
            desc: "上下文长度,Llama 3.3 原生 128k 可酌情拉满",
          },
          { key: "--gpu-memory-utilization", value: "0.92", desc: "KV cache 预算" },
        ],
        resource: "70B: 4× H100 80GB / A100 80GB · 8B: 1× L20 / A100",
        notes: "Llama 3.3 模板新增 toolcalls,客户端需走 OpenAI tool-use 协议。",
        docUrl: "https://docs.vllm.ai/en/latest/models/supported_models.html",
      }),
      sglang: native({
        minVersion: "0.4.0",
        image: "lmsysorg/sglang:v0.4.3-cu124",
        tooltip: "SGLang ≥ 0.4.0,RadixAttention 默认开",
        command: `docker run --gpus all --shm-size 16g \\
  -p 30000:30000 ${HF_VOL} \\
  lmsysorg/sglang:v0.4.3-cu124 \\
  python -m sglang.launch_server \\
    --model-path meta-llama/Llama-3.3-70B-Instruct \\
    --tp 4 \\
    --host 0.0.0.0 --port 30000`,
        params: [
          { key: "--tp", value: "4", desc: "70B 推荐 4 卡 TP" },
          { key: "--mem-fraction-static", value: "0.85", desc: "缓存比例,过高易 OOM" },
        ],
        resource: "70B: 4× H100 / A100 80GB",
        docUrl: "https://docs.sglang.ai/backend/server_arguments.html",
      }),
      trtllm: native({
        minVersion: "0.10.0",
        image: "nvcr.io/nvidia/tritonserver:24.10-trtllm-python-py3",
        tooltip: "需要预先 trtllm-build 转引擎",
        notes: "需先 trtllm-build 把 HF 权重编为 .engine,推荐 FP8 / W4A16 量化提升吞吐。",
        docUrl: "https://nvidia.github.io/TensorRT-LLM/llm-api/index.html",
      }),
      mindie: native({
        minVersion: "1.0.RC3",
        image: "swr.cn-south-1.myhuaweicloud.com/ascendhub/mindie:1.0.RC3-800I-A2",
        tooltip: "Atlas 800I A2 / 910B,FP16 直跑",
        notes:
          "需预下载权重到 /workspace/models;config.json 配 Llama 模板。Ascend 设备 socket 须挂载。",
        docUrl: "https://www.hiascend.com/document/detail/zh/mindie/10RC3/index/index.html",
      }),
      lmdeploy: native({
        minVersion: "0.6.0",
        image: "openmmlab/lmdeploy:v0.6.4",
        tooltip: "TurboMind 后端,W4A16 加速明显",
        command: `docker run --gpus all --shm-size 16g \\
  -p 23333:23333 ${HF_VOL} \\
  openmmlab/lmdeploy:v0.6.4 \\
  lmdeploy serve api_server \\
    meta-llama/Llama-3.3-70B-Instruct \\
    --backend turbomind --tp 4 \\
    --server-port 23333`,
        params: [
          {
            key: "--backend",
            value: "turbomind",
            desc: "首选 turbomind;PyTorch 后端用 --backend pytorch",
          },
          { key: "--tp", value: "4", desc: "70B 推荐 4 卡 TP" },
        ],
        resource: "70B: 4× A100 80GB",
        docUrl: "https://lmdeploy.readthedocs.io/",
      }),
      tgi: native({
        minVersion: "2.3",
        image: "ghcr.io/huggingface/text-generation-inference:2.3.0",
        tooltip: "Llama 3.x 一等公民支持",
        notes: "shm-size ≥ 1g 否则多卡 NCCL 报错;HF token 通过 -e HF_TOKEN 注入。",
        docUrl: "https://huggingface.co/docs/text-generation-inference/index",
      }),
      llamacpp: native({
        minVersion: "b3300",
        image: "ghcr.io/ggerganov/llama.cpp:server",
        tooltip: "GGUF 量化版本,本地 CPU/Metal/ROCm 都行",
        notes: "70B 推荐 Q4_K_M(~40GB)+ mmap;长上下文用 -c 32768。",
        docUrl: "https://github.com/ggml-org/llama.cpp",
      }),
    },
  },
  {
    id: "qwen-2-5",
    name: "Qwen2.5 / Qwen3 (0.5B–72B)",
    category: "dense",
    meta: "阿里 · 中文首选",
    engines: {
      vllm: native({
        minVersion: "0.6.3",
        image: "vllm/vllm-openai:v0.7.3",
        tooltip: "Qwen2.5/3 全规格,72B 推荐 TP=4",
        command: `docker run --gpus all --shm-size 16g \\
  -p 8000:8000 ${HF_VOL} \\
  vllm/vllm-openai:v0.7.3 \\
  --model Qwen/Qwen2.5-72B-Instruct \\
  --tensor-parallel-size 4 \\
  --max-model-len 32768 \\
  --enforce-eager`,
        params: [
          { key: "--tensor-parallel-size", value: "4", desc: "72B 推荐 4 卡 TP" },
          { key: "--rope-scaling", value: "yarn", desc: "需要 128k 时配 YARN" },
        ],
        resource: "72B: 4× A100/H100 80GB · 7B: 1 卡",
        docUrl: "https://qwen.readthedocs.io/en/latest/deployment/vllm.html",
      }),
      sglang: native({
        minVersion: "0.4.0",
        image: "lmsysorg/sglang:v0.4.3-cu124",
        tooltip: "Qwen2.5 一等公民,prefix cache 命中率高",
        command: `docker run --gpus all --shm-size 16g \\
  -p 30000:30000 ${HF_VOL} \\
  lmsysorg/sglang:v0.4.3-cu124 \\
  python -m sglang.launch_server \\
    --model-path Qwen/Qwen2.5-72B-Instruct \\
    --tp 4 --host 0.0.0.0 --port 30000`,
        params: [{ key: "--tp", value: "4", desc: "72B 推荐 4 卡 TP" }],
        resource: "72B: 4× A100/H100 80GB",
        docUrl: "https://docs.sglang.ai/",
      }),
      trtllm: native({
        minVersion: "0.13.0",
        image: "nvcr.io/nvidia/tritonserver:24.10-trtllm-python-py3",
        tooltip: "Qwen2 系列需 0.13+",
        notes:
          "Qwen2.5 需要 trtllm 0.13+;Qwen3 建议 1.0+。先 trtllm-build,后用 trtllm-serve 启动。",
        docUrl: "https://nvidia.github.io/TensorRT-LLM/",
      }),
      mindie: native({
        minVersion: "1.0.RC3",
        image: "swr.cn-south-1.myhuaweicloud.com/ascendhub/mindie:1.0.RC3-800I-A2",
        tooltip: "国产场景首选,Qwen2.5 模板内置",
        docUrl: "https://www.hiascend.com/document/detail/zh/mindie/",
      }),
      lmdeploy: native({
        minVersion: "0.6.0",
        image: "openmmlab/lmdeploy:v0.6.4",
        tooltip: "TurboMind + AWQ 量化跑得最快",
        command: `docker run --gpus all --shm-size 16g \\
  -p 23333:23333 ${HF_VOL} \\
  openmmlab/lmdeploy:v0.6.4 \\
  lmdeploy serve api_server \\
    Qwen/Qwen2.5-72B-Instruct-AWQ \\
    --backend turbomind --tp 2 \\
    --model-format awq --quant-policy 4`,
        notes: "AWQ 版本可压到 2 卡 80GB。",
        docUrl: "https://lmdeploy.readthedocs.io/",
      }),
      tgi: native({
        minVersion: "2.3",
        image: "ghcr.io/huggingface/text-generation-inference:2.3.0",
        tooltip: "Qwen2.5 / Qwen3 主线支持",
        docUrl: "https://huggingface.co/docs/text-generation-inference/",
      }),
      llamacpp: native({
        minVersion: "b3500",
        image: "ghcr.io/ggerganov/llama.cpp:server",
        tooltip: "GGUF 中文表现稳",
        notes: "Qwen3-Thinking 类模型需用 b4300+ 才能正确处理 <think> 标签。",
        docUrl: "https://github.com/ggml-org/llama.cpp",
      }),
    },
  },
  {
    id: "mistral",
    name: "Mistral 7B / Nemo / Small",
    category: "dense",
    meta: "Mistral AI",
    engines: {
      vllm: native({
        minVersion: "0.5.0",
        image: "vllm/vllm-openai:v0.7.3",
        tooltip: "Mistral / Nemo / Small 全系列",
        notes: "Mistral 模板不带 system role,客户端需自行拼装。",
        docUrl: "https://docs.vllm.ai/",
      }),
      sglang: native({
        minVersion: "0.4.0",
        image: "lmsysorg/sglang:v0.4.3-cu124",
        tooltip: "Mistral 系列原生支持",
      }),
      trtllm: native({
        minVersion: "0.10.0",
        image: "nvcr.io/nvidia/tritonserver:24.10-trtllm-python-py3",
        tooltip: "需 trtllm-build 转引擎",
      }),
      mindie: partial({
        tooltip: "Mistral 7B 走通用 Llama 模板,Nemo / Small 需自行验证",
        notes: "// TODO: Nemo tokenizer 兼容性待验证。",
      }),
      lmdeploy: native({
        minVersion: "0.6.0",
        image: "openmmlab/lmdeploy:v0.6.4",
        tooltip: "TurboMind 支持 Mistral",
      }),
      tgi: native({
        minVersion: "2.0",
        image: "ghcr.io/huggingface/text-generation-inference:2.3.0",
        tooltip: "TGI 长期 first-class 支持",
      }),
      llamacpp: native({
        minVersion: "b3000",
        image: "ghcr.io/ggerganov/llama.cpp:server",
        tooltip: "GGUF 量化版本广泛可用",
      }),
    },
  },
  {
    id: "gemma",
    name: "Gemma 2 / 3",
    category: "dense",
    meta: "Google",
    engines: {
      vllm: native({
        minVersion: "0.5.4",
        image: "vllm/vllm-openai:v0.7.3",
        tooltip: "Gemma 2/3 文本部分;Gemma 3 多模态见 VLM 行",
      }),
      sglang: native({
        minVersion: "0.4.1",
        image: "lmsysorg/sglang:v0.4.3-cu124",
        tooltip: "Gemma 2/3-text 支持",
      }),
      trtllm: partial({
        tooltip: "Gemma 2 部分支持,Gemma 3 等 trtllm 1.x",
        notes: "// TODO: Gemma 3 trtllm-build 兼容性待 NVIDIA 1.x 路线图确认。",
      }),
      lmdeploy: native({
        minVersion: "0.6.2",
        image: "openmmlab/lmdeploy:v0.6.4",
        tooltip: "Gemma 2/3 原生",
      }),
      tgi: native({
        minVersion: "2.2",
        image: "ghcr.io/huggingface/text-generation-inference:2.3.0",
        tooltip: "Google + HF 共建",
      }),
      llamacpp: native({
        minVersion: "b3300",
        image: "ghcr.io/ggerganov/llama.cpp:server",
        tooltip: "GGUF 已上 ggml-org",
      }),
    },
  },
  {
    id: "phi",
    name: "Phi-3 / Phi-4",
    category: "dense",
    meta: "Microsoft",
    engines: {
      vllm: native({
        minVersion: "0.6.4",
        image: "vllm/vllm-openai:v0.7.3",
        tooltip: "Phi-3.5 / Phi-4 14B 直接跑",
      }),
      sglang: native({
        minVersion: "0.4.0",
        image: "lmsysorg/sglang:v0.4.3-cu124",
        tooltip: "Phi-3 / Phi-4 主线支持",
      }),
      trtllm: native({
        minVersion: "0.13.0",
        image: "nvcr.io/nvidia/tritonserver:24.10-trtllm-python-py3",
        tooltip: "Phi-3 ✓,Phi-4 需 trtllm 1.0+",
      }),
      lmdeploy: native({
        minVersion: "0.6.0",
        image: "openmmlab/lmdeploy:v0.6.4",
        tooltip: "TurboMind 支持",
      }),
      tgi: native({
        minVersion: "2.2",
        image: "ghcr.io/huggingface/text-generation-inference:2.3.0",
      }),
      llamacpp: native({
        minVersion: "b3300",
        image: "ghcr.io/ggerganov/llama.cpp:server",
      }),
    },
  },
  {
    id: "internlm",
    name: "InternLM3",
    category: "dense",
    meta: "上海 AI Lab",
    engines: {
      vllm: native({
        minVersion: "0.6.0",
        image: "vllm/vllm-openai:v0.7.3",
        tooltip: "InternLM3 8B 文本",
      }),
      sglang: partial({
        tooltip: "通过通用 LlamaForCausalLM 路径加载,部分模板需自定",
      }),
      lmdeploy: native({
        minVersion: "0.6.4",
        image: "openmmlab/lmdeploy:v0.6.4",
        tooltip: "InternLM 自家引擎,首选",
        command: `docker run --gpus all --shm-size 16g \\
  -p 23333:23333 ${HF_VOL} \\
  openmmlab/lmdeploy:v0.6.4 \\
  lmdeploy serve api_server internlm/internlm3-8b-instruct \\
    --backend turbomind --tp 1`,
        docUrl: "https://lmdeploy.readthedocs.io/",
      }),
      tgi: partial({ tooltip: "可加载,模板需手动配置" }),
      llamacpp: native({
        minVersion: "b3500",
        image: "ghcr.io/ggerganov/llama.cpp:server",
      }),
    },
  },
  {
    id: "glm-4",
    name: "GLM-4",
    category: "dense",
    meta: "智谱",
    engines: {
      vllm: native({
        minVersion: "0.6.0",
        image: "vllm/vllm-openai:v0.7.3",
        tooltip: "GLM-4 9B/Air 文本",
        notes: "GLM-4 需 --trust-remote-code。",
      }),
      sglang: native({
        minVersion: "0.4.0",
        image: "lmsysorg/sglang:v0.4.3-cu124",
        tooltip: "GLM-4 主线支持",
      }),
      lmdeploy: native({
        minVersion: "0.6.2",
        image: "openmmlab/lmdeploy:v0.6.4",
        tooltip: "TurboMind + GLM-4 模板",
      }),
      mindie: partial({ tooltip: "通过通用模板可跑,需自行验证 chat template" }),
      llamacpp: native({
        minVersion: "b3700",
        image: "ghcr.io/ggerganov/llama.cpp:server",
      }),
    },
  },
  {
    id: "yi",
    name: "Yi-1.5",
    category: "dense",
    meta: "零一万物",
    engines: {
      vllm: native({
        minVersion: "0.5.0",
        image: "vllm/vllm-openai:v0.7.3",
      }),
      sglang: native({
        minVersion: "0.4.0",
        image: "lmsysorg/sglang:v0.4.3-cu124",
      }),
      lmdeploy: native({
        minVersion: "0.6.0",
        image: "openmmlab/lmdeploy:v0.6.4",
      }),
      tgi: native({
        minVersion: "2.0",
        image: "ghcr.io/huggingface/text-generation-inference:2.3.0",
      }),
      llamacpp: native({
        minVersion: "b3000",
        image: "ghcr.io/ggerganov/llama.cpp:server",
      }),
    },
  },

  // =========================================================================
  // B. MoE 大模型
  // =========================================================================
  {
    id: "deepseek-v3",
    name: "DeepSeek-V3 / R1 (671B)",
    category: "moe",
    meta: "DeepSeek · MLA + MoE",
    engines: {
      vllm: native({
        minVersion: "0.7.0",
        image: "vllm/vllm-openai:v0.7.3",
        tooltip: "vLLM ≥ 0.7 完整支持 MLA + MoE 路由",
        command: `docker run --gpus all --shm-size 32g \\
  -p 8000:8000 ${HF_VOL} \\
  vllm/vllm-openai:v0.7.3 \\
  --model deepseek-ai/DeepSeek-V3 \\
  --tensor-parallel-size 8 \\
  --max-model-len 65536 \\
  --trust-remote-code \\
  --enable-expert-parallel \\
  --gpu-memory-utilization 0.92`,
        params: [
          { key: "--tensor-parallel-size", value: "8", desc: "MLA 友好,8 卡 TP" },
          { key: "--enable-expert-parallel", value: "(flag)", desc: "启用 EP 提升 MoE 吞吐" },
          { key: "--max-model-len", value: "65536", desc: "默认上下文 64k,可拉满 128k" },
          { key: "--trust-remote-code", value: "(flag)", desc: "DeepSeek 自定义 attn 实现" },
        ],
        resource: "8× H100 80GB / H800 · 启用 EP",
        notes: "shm-size 必须 ≥ 32g;FP8 量化版本需 vLLM 0.7.3+。",
        docUrl: "https://docs.vllm.ai/en/latest/models/supported_models.html",
      }),
      sglang: native({
        minVersion: "0.4.0",
        image: "lmsysorg/sglang:v0.4.3-cu124",
        tooltip: "SGLang 0.4 起官方推 DSV3 优化",
        command: `docker run --gpus all --shm-size 32g \\
  -p 30000:30000 ${HF_VOL} \\
  lmsysorg/sglang:v0.4.3-cu124 \\
  python -m sglang.launch_server \\
    --model-path deepseek-ai/DeepSeek-V3 \\
    --tp 8 --trust-remote-code \\
    --enable-dp-attention \\
    --host 0.0.0.0 --port 30000`,
        params: [
          { key: "--tp", value: "8", desc: "8 卡 TP" },
          {
            key: "--enable-dp-attention",
            value: "(flag)",
            desc: "DP-attention 提升长 context 吞吐",
          },
        ],
        resource: "8× H100 / H800 80GB",
        docUrl: "https://docs.sglang.ai/references/deepseek.html",
      }),
      trtllm: partial({
        minVersion: "1.0.0",
        tooltip: "trtllm 1.0+ 起加 MLA / DSV3 路径",
        notes: "DSV3 + FP8 在 trtllm 上还在打磨,生产建议先用 vLLM/SGLang。",
      }),
      mindie: native({
        minVersion: "1.0.RC3",
        image: "swr.cn-south-1.myhuaweicloud.com/ascendhub/mindie:1.0.RC3-800I-A2",
        tooltip: "Atlas 800I A2 / 910B,DSV3 已对接",
        notes: "需 16 卡 910B 跑 671B 全量;Lite 版本下放到 8 卡。",
        docUrl: "https://www.hiascend.com/document/detail/zh/mindie/",
      }),
      lmdeploy: partial({
        tooltip: "PyTorch 后端可加载,turbomind 暂未优化 MLA",
        notes: "// TODO: 等 LMDeploy 0.7+ 给 MLA 加官方路径。",
      }),
      llamacpp: partial({
        tooltip: "社区 fork 有 GGUF,Q4_K 量化勉强可推理",
        notes: "上下游分歧大,生产不建议。",
      }),
    },
  },
  {
    id: "deepseek-v2",
    name: "DeepSeek-V2 (236B)",
    category: "moe",
    meta: "DeepSeek · MoE",
    engines: {
      vllm: native({
        minVersion: "0.5.4",
        image: "vllm/vllm-openai:v0.7.3",
        tooltip: "DSV2 / V2-Lite 支持完善",
      }),
      sglang: native({
        minVersion: "0.3.0",
        image: "lmsysorg/sglang:v0.4.3-cu124",
      }),
      mindie: native({
        minVersion: "1.0.RC3",
        image: "swr.cn-south-1.myhuaweicloud.com/ascendhub/mindie:1.0.RC3-800I-A2",
      }),
      lmdeploy: partial({ tooltip: "PyTorch 后端可跑,turbomind 不支持" }),
    },
  },
  {
    id: "qwen3-moe",
    name: "Qwen3-MoE (30B-A3B / 235B-A22B)",
    category: "moe",
    meta: "阿里 · MoE",
    engines: {
      vllm: native({
        minVersion: "0.7.0",
        image: "vllm/vllm-openai:v0.7.3",
        tooltip: "Qwen3-MoE 235B 推荐 8 卡 TP + EP",
        command: `docker run --gpus all --shm-size 32g \\
  -p 8000:8000 ${HF_VOL} \\
  vllm/vllm-openai:v0.7.3 \\
  --model Qwen/Qwen3-235B-A22B-Instruct-2507 \\
  --tensor-parallel-size 8 \\
  --enable-expert-parallel \\
  --max-model-len 32768 \\
  --trust-remote-code`,
        resource: "235B: 8× H100 80GB · 30B-A3B: 2× A100",
        docUrl: "https://qwen.readthedocs.io/",
      }),
      sglang: native({
        minVersion: "0.4.3",
        image: "lmsysorg/sglang:v0.4.3-cu124",
        tooltip: "Qwen3-MoE 已合并主线",
      }),
      trtllm: partial({ tooltip: "30B-A3B 部分支持,235B 待验证" }),
      mindie: partial({
        tooltip: "30B-A3B 已对接,235B 待昇腾 1.0.RC4 路线图",
        notes: "// TODO: 235B-A22B on Ascend 待 1.0.RC4 release notes 确认。",
      }),
    },
  },
  {
    id: "llama4",
    name: "Llama 4 Scout / Maverick",
    category: "moe",
    meta: "Meta · 多模态 MoE",
    engines: {
      vllm: native({
        minVersion: "0.8.0",
        image: "vllm/vllm-openai:v0.8.4",
        tooltip: "Llama 4 需 vLLM 0.8+",
        notes:
          "Scout/Maverick 都是 MoE 多模态,启动加 --limit-mm-per-prompt 与 --enable-expert-parallel。",
      }),
      sglang: native({
        minVersion: "0.4.5",
        image: "lmsysorg/sglang:v0.4.5-cu124",
        tooltip: "Llama 4 第一波支持引擎之一",
      }),
      trtllm: partial({ tooltip: "trtllm 1.0+ 加入,持续打磨" }),
    },
  },
  {
    id: "gpt-oss",
    name: "GPT-OSS-120B / 20B",
    category: "moe",
    meta: "OpenAI · 开源 MoE",
    engines: {
      vllm: native({
        minVersion: "0.10.0",
        image: "vllm/vllm-openai:v0.10.0",
        tooltip: "vLLM 官方对接,FP8 推理",
        notes: "120B 推荐 8× H100;20B 单机 1×H100 即可。",
      }),
      sglang: native({
        minVersion: "0.4.6",
        image: "lmsysorg/sglang:v0.4.6-cu124",
        tooltip: "SGLang 紧跟 OpenAI 开源",
      }),
      trtllm: partial({ tooltip: "trtllm 1.0+ 路径 in flight" }),
    },
  },
  {
    id: "mixtral-moe",
    name: "Mixtral 8x7B / 8x22B",
    category: "moe",
    meta: "Mistral AI · 经典 MoE",
    engines: {
      vllm: native({
        minVersion: "0.4.0",
        image: "vllm/vllm-openai:v0.7.3",
        tooltip: "Mixtral 8x22B 推荐 4-8 卡 TP",
      }),
      sglang: native({
        minVersion: "0.3.0",
        image: "lmsysorg/sglang:v0.4.3-cu124",
      }),
      trtllm: native({
        minVersion: "0.10.0",
        image: "nvcr.io/nvidia/tritonserver:24.10-trtllm-python-py3",
        tooltip: "Mixtral 是 TRT-LLM MoE 第一公民",
      }),
      mindie: partial({ tooltip: "8x7B 通用模板可跑,8x22B 需自行验证" }),
      lmdeploy: native({
        minVersion: "0.6.0",
        image: "openmmlab/lmdeploy:v0.6.4",
      }),
      tgi: native({
        minVersion: "1.4",
        image: "ghcr.io/huggingface/text-generation-inference:2.3.0",
        tooltip: "Mixtral 是 TGI MoE 主线",
      }),
      llamacpp: native({
        minVersion: "b3500",
        image: "ghcr.io/ggerganov/llama.cpp:server",
        tooltip: "GGUF 8x7B Q4_K_M ~24GB",
      }),
    },
  },

  // =========================================================================
  // C. 多模态 / VLM
  // =========================================================================
  {
    id: "qwen-vl",
    name: "Qwen2.5-VL / Qwen3-VL",
    category: "vlm",
    meta: "阿里 · 视觉语言",
    engines: {
      vllm: native({
        minVersion: "0.7.0",
        image: "vllm/vllm-openai:v0.7.3",
        tooltip: "Qwen2.5-VL 7B/72B 主线",
        command: `docker run --gpus all --shm-size 16g \\
  -p 8000:8000 ${HF_VOL} \\
  vllm/vllm-openai:v0.7.3 \\
  --model Qwen/Qwen2.5-VL-7B-Instruct \\
  --max-model-len 32768 \\
  --limit-mm-per-prompt image=4 \\
  --trust-remote-code`,
        params: [
          { key: "--limit-mm-per-prompt", value: "image=4", desc: "单 prompt 最多 4 图" },
          { key: "--max-num-seqs", value: "8", desc: "并发降低显存压力" },
        ],
        docUrl:
          "https://docs.vllm.ai/en/latest/models/supported_models.html#multimodal-language-models",
      }),
      sglang: native({
        minVersion: "0.4.2",
        image: "lmsysorg/sglang:v0.4.3-cu124",
        tooltip: "Qwen-VL 视觉编码器 + 语言塔",
      }),
      lmdeploy: native({
        minVersion: "0.6.0",
        image: "openmmlab/lmdeploy:v0.6.4",
        tooltip: "TurboMind VLM 路径,支持图文",
      }),
      mindie: partial({ tooltip: "Qwen2-VL 模板已就绪,Qwen2.5/3-VL 持续完善" }),
      tgi: partial({ tooltip: "通过 multimodal 路径,部分图像分辨率限制" }),
    },
  },
  {
    id: "internvl",
    name: "InternVL3",
    category: "vlm",
    meta: "上海 AI Lab · VLM",
    engines: {
      vllm: native({
        minVersion: "0.7.0",
        image: "vllm/vllm-openai:v0.7.3",
        tooltip: "InternVL3 8B/38B 主线支持",
      }),
      sglang: partial({ tooltip: "需要 0.4.3+,部分 chat template 自定义" }),
      lmdeploy: native({
        minVersion: "0.6.0",
        image: "openmmlab/lmdeploy:v0.6.4",
        tooltip: "InternVL 系列首选",
      }),
    },
  },
  {
    id: "llava-next",
    name: "LLaVA-Next",
    category: "vlm",
    meta: "UW · LLaVA 系列",
    engines: {
      vllm: native({
        minVersion: "0.5.0",
        image: "vllm/vllm-openai:v0.7.3",
        tooltip: "LLaVA-Next-Video 也支持",
      }),
      sglang: native({
        minVersion: "0.4.0",
        image: "lmsysorg/sglang:v0.4.3-cu124",
      }),
      lmdeploy: native({
        minVersion: "0.6.0",
        image: "openmmlab/lmdeploy:v0.6.4",
      }),
      tgi: partial({ tooltip: "LLaVA-Next 走 messages API,需 multimodal flag" }),
    },
  },
  {
    id: "minicpm-v",
    name: "MiniCPM-V 2.6 / o2.6",
    category: "vlm",
    meta: "面壁智能",
    engines: {
      vllm: native({
        minVersion: "0.6.0",
        image: "vllm/vllm-openai:v0.7.3",
        tooltip: "MiniCPM-V 2.6 / o2.6 全模态",
      }),
      sglang: partial({ tooltip: "通过通用 VLM 路径加载" }),
      lmdeploy: native({
        minVersion: "0.6.0",
        image: "openmmlab/lmdeploy:v0.6.4",
      }),
      llamacpp: partial({ tooltip: "GGUF 量化 + clip vision encoder 走 minicpmv-cli" }),
    },
  },
  {
    id: "pixtral",
    name: "Pixtral 12B",
    category: "vlm",
    meta: "Mistral · VLM",
    engines: {
      vllm: native({
        minVersion: "0.6.2",
        image: "vllm/vllm-openai:v0.7.3",
        tooltip: "Mistral 官方推荐用 vLLM",
      }),
      sglang: native({
        minVersion: "0.4.0",
        image: "lmsysorg/sglang:v0.4.3-cu124",
      }),
      lmdeploy: partial({ tooltip: "PyTorch 后端可跑" }),
    },
  },
  {
    id: "gemma-3-mm",
    name: "Gemma 3 (multimodal)",
    category: "vlm",
    meta: "Google · 多模态",
    engines: {
      vllm: native({
        minVersion: "0.8.0",
        image: "vllm/vllm-openai:v0.8.4",
        tooltip: "Gemma 3 视觉部分需 0.8+",
      }),
      sglang: native({
        minVersion: "0.4.4",
        image: "lmsysorg/sglang:v0.4.4-cu124",
      }),
      lmdeploy: partial({ tooltip: "0.7+ 路线图" }),
    },
  },

  // =========================================================================
  // D. Embedding
  // =========================================================================
  {
    id: "bge-m3",
    name: "BGE-M3",
    category: "embedding",
    meta: "BAAI · 多语言密集 + 稀疏",
    engines: {
      tei: native({
        minVersion: "1.5",
        image: "ghcr.io/huggingface/text-embeddings-inference:1.5",
        tooltip: "TEI 是 BGE 系列首选",
        command: `docker run --gpus all -p 8080:80 ${HF_VOL} \\
  ghcr.io/huggingface/text-embeddings-inference:1.5 \\
  --model-id BAAI/bge-m3 \\
  --max-batch-tokens 16384`,
        params: [
          { key: "--model-id", value: "BAAI/bge-m3", desc: "HF 仓库 id" },
          { key: "--max-batch-tokens", value: "16384", desc: "批量 token 上限" },
        ],
        resource: "1× T4 / L4 / A10G",
        docUrl: "https://huggingface.co/docs/text-embeddings-inference/index",
      }),
      infinity: native({
        minVersion: "0.0.70",
        image: "michaelf34/infinity:0.0.75",
        tooltip: "Infinity 跑多模型多并发友好",
        command: `docker run --gpus all -p 7997:7997 ${HF_VOL} \\
  michaelf34/infinity:0.0.75 \\
  v2 --model-id BAAI/bge-m3 --port 7997`,
        docUrl: "https://github.com/michaelfeil/infinity",
      }),
      vllm: partial({
        minVersion: "0.6.0",
        tooltip: "vLLM 0.6+ 实验性 embeddings endpoint",
        notes: "用 --task embed 启动;sparse 输出走 ColBERT 路径需自行实现。",
      }),
      llamacpp: native({
        minVersion: "b3500",
        image: "ghcr.io/ggerganov/llama.cpp:server",
        tooltip: "llama-server --embedding,GGUF",
      }),
      mindie: partial({ tooltip: "MindIE Service 1.0.RC3+ 提供 embedding endpoint" }),
    },
  },
  {
    id: "qwen3-embed",
    name: "Qwen3-Embedding (0.6B / 4B / 8B)",
    category: "embedding",
    meta: "阿里 · 通用嵌入",
    engines: {
      tei: native({
        minVersion: "1.6",
        image: "ghcr.io/huggingface/text-embeddings-inference:1.6",
        tooltip: "Qwen3-Embedding 走 LLM-style embedding",
        notes: "Qwen3-Embedding 模型用 TEI 的 --pooling lasttoken。",
      }),
      infinity: native({
        minVersion: "0.0.74",
        image: "michaelf34/infinity:0.0.75",
        tooltip: "Infinity 自动识别 lasttoken pooling",
      }),
      vllm: partial({
        tooltip: '需 --task embed + --override-generation-config \'{"pooling":"lasttoken"}\'',
      }),
    },
  },
  {
    id: "gte-e5",
    name: "GTE / E5",
    category: "embedding",
    meta: "阿里 · 微软",
    engines: {
      tei: native({
        minVersion: "1.5",
        image: "ghcr.io/huggingface/text-embeddings-inference:1.5",
      }),
      infinity: native({
        minVersion: "0.0.70",
        image: "michaelf34/infinity:0.0.75",
      }),
      vllm: partial({ tooltip: "通过 --task embed 加载,默认 mean pooling" }),
      llamacpp: native({
        minVersion: "b3500",
        image: "ghcr.io/ggerganov/llama.cpp:server",
      }),
    },
  },
  {
    id: "jina-embed-v3",
    name: "Jina Embeddings v3",
    category: "embedding",
    meta: "Jina AI",
    engines: {
      tei: native({
        minVersion: "1.5",
        image: "ghcr.io/huggingface/text-embeddings-inference:1.5",
        tooltip: "Jina v3 LoRA adapters 走 task 路径",
        notes: "需要传 task=retrieval.query/passage 切换 LoRA。",
      }),
      infinity: native({
        minVersion: "0.0.70",
        image: "michaelf34/infinity:0.0.75",
      }),
    },
  },
  {
    id: "nomic-embed",
    name: "Nomic Embed v1.5",
    category: "embedding",
    meta: "Nomic · 长文本",
    engines: {
      tei: native({
        minVersion: "1.5",
        image: "ghcr.io/huggingface/text-embeddings-inference:1.5",
      }),
      infinity: native({
        minVersion: "0.0.70",
        image: "michaelf34/infinity:0.0.75",
      }),
      llamacpp: native({
        minVersion: "b3500",
        image: "ghcr.io/ggerganov/llama.cpp:server",
      }),
    },
  },

  // =========================================================================
  // E. Rerank
  // =========================================================================
  {
    id: "bge-rerank-v2",
    name: "BGE-Reranker-v2-M3",
    category: "rerank",
    meta: "BAAI · 多语言重排",
    engines: {
      tei: native({
        minVersion: "1.5",
        image: "ghcr.io/huggingface/text-embeddings-inference:1.5",
        tooltip: "TEI 1.5 起原生支持 cross-encoder",
        command: `docker run --gpus all -p 8080:80 ${HF_VOL} \\
  ghcr.io/huggingface/text-embeddings-inference:1.5 \\
  --model-id BAAI/bge-reranker-v2-m3 \\
  --max-batch-tokens 16384`,
        notes: "调用 /rerank,与 embedding endpoint 同实例可分模型部署。",
        docUrl: "https://huggingface.co/docs/text-embeddings-inference/",
      }),
      infinity: native({
        minVersion: "0.0.70",
        image: "michaelf34/infinity:0.0.75",
        tooltip: "Infinity 同时跑 embedding + rerank",
      }),
      vllm: partial({
        minVersion: "0.7.0",
        tooltip: "vLLM 0.7+ 实验 score endpoint(/v1/score)",
      }),
    },
  },
  {
    id: "qwen3-rerank",
    name: "Qwen3-Reranker (0.6B / 4B / 8B)",
    category: "rerank",
    meta: "阿里 · 重排",
    engines: {
      tei: native({
        minVersion: "1.6",
        image: "ghcr.io/huggingface/text-embeddings-inference:1.6",
        tooltip: "Qwen3-Reranker 是 LLM-as-reranker 路径",
        notes: "需要 --pooling cls + classifier head;某些版本走 generative scorer。",
      }),
      infinity: native({
        minVersion: "0.0.74",
        image: "michaelf34/infinity:0.0.75",
      }),
      vllm: partial({ tooltip: "通过 /v1/score 路径,生产前请压测" }),
    },
  },
  {
    id: "jina-rerank-v2",
    name: "Jina Reranker v2",
    category: "rerank",
    meta: "Jina AI",
    engines: {
      tei: native({
        minVersion: "1.5",
        image: "ghcr.io/huggingface/text-embeddings-inference:1.5",
      }),
      infinity: native({
        minVersion: "0.0.70",
        image: "michaelf34/infinity:0.0.75",
      }),
    },
  },

  // =========================================================================
  // F. 文生图(Diffusion)
  // =========================================================================
  {
    id: "sdxl",
    name: "Stable Diffusion XL / 3.5",
    category: "diffusion",
    meta: "Stability AI",
    engines: {
      comfyui: native({
        minVersion: "v0.3.0",
        image: "yanwk/comfyui-boot:cu124-megapak",
        tooltip: "ComfyUI 是 SD/SDXL 生态首选",
        command: `docker run --gpus all -p 8188:8188 \\
  -v $PWD/models:/root/ComfyUI/models \\
  -v $PWD/output:/root/ComfyUI/output \\
  yanwk/comfyui-boot:cu124-megapak`,
        params: [
          {
            key: "models",
            value: "checkpoints/sd_xl_base_1.0.safetensors",
            desc: "需提前下载 ckpt 到 models/checkpoints/",
          },
        ],
        resource: "1× 12GB+ 显存,SDXL 1024² 约 8GB",
        docUrl: "https://docs.comfy.org/",
      }),
    },
  },
  {
    id: "flux",
    name: "FLUX.1 (dev / schnell)",
    category: "diffusion",
    meta: "Black Forest Labs",
    engines: {
      comfyui: native({
        minVersion: "v0.3.0",
        image: "yanwk/comfyui-boot:cu124-megapak",
        tooltip: "FLUX schnell 4 步出图,dev 20 步",
        notes: "FLUX 需要单独的 t5xxl_fp8 + clip_l 文件,放到 models/clip/。",
        docUrl: "https://comfyanonymous.github.io/ComfyUI_examples/flux/",
      }),
    },
  },
  {
    id: "qwen-image",
    name: "Qwen-Image",
    category: "diffusion",
    meta: "阿里 · 文生图",
    engines: {
      comfyui: partial({
        tooltip: "社区节点已支持,官方 workflow 待完善",
        notes: "// TODO: 待官方 ComfyUI workflow 发布,补充镜像与节点 hash。",
      }),
    },
  },
  {
    id: "hunyuan-dit",
    name: "HunyuanDiT",
    category: "diffusion",
    meta: "腾讯 · 中文文生图",
    engines: {
      comfyui: native({
        minVersion: "v0.2.0",
        image: "yanwk/comfyui-boot:cu124-megapak",
        tooltip: "ComfyUI 自带 HunyuanDiT 节点",
      }),
    },
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getRecipeStatus(model: ModelEntry, engineId: string): RecipeStatus {
  const recipe = model.engines[engineId as keyof typeof model.engines];
  return recipe?.status ?? "none";
}

export function getRecipe(model: ModelEntry, engineId: string): EngineRecipe | undefined {
  return model.engines[engineId as keyof typeof model.engines];
}
