/** GPUStack `/v2` 响应的子集 —— 只声明本模块读取的字段（snake_case 原样）。 */
export interface GpustackPage<T> {
  items: T[];
  pagination: { page: number; perPage: number; total: number; totalPage: number };
}

export interface GpustackModel {
  id: number;
  name: string;
  categories?: string[] | null;
  cluster_id?: number | null;
  replicas?: number;
  ready_replicas?: number;
  backend?: string | null;
  backend_version?: string | null;
  backend_parameters?: string[] | null;
  image_name?: string | null;
  run_command?: string | null;
  env?: Record<string, string> | null;
  gpu_selector?: unknown;
  gpu_type_selector?: unknown;
  worker_selector?: Record<string, string> | null;
  extended_kv_cache?: unknown;
  placement_strategy?: string | null;
  distributed_inference_across_workers?: boolean | null;
  cpu_offloading?: boolean | null;
  source?: string | null;
  huggingface_repo_id?: string | null;
  huggingface_filename?: string | null;
  model_scope_model_id?: string | null;
  model_scope_file_path?: string | null;
  local_path?: string | null;
}

export interface GpustackInstance {
  id: number;
  model_id: number;
  state: string;
  worker_name?: string | null;
  gpu_type?: string | null;
  gpu_indexes?: number[] | null;
  api_detected_backend_version?: string | null;
}

export interface GpustackRoute {
  id: number;
  name: string;
  effective_name?: string | null;
  created_model_id?: number | null;
  targets: number;
}
