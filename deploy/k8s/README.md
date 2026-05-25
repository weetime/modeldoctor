# Kubernetes deploy artifacts

## RBAC for the benchmark feature

`rbac.yaml` declares the namespace `modeldoctor-benchmarks` (where benchmark
Jobs and Secrets land), the ServiceAccount `modeldoctor-api` in namespace
`modeldoctor`, a Role scoped to the benchmarks namespace, and a RoleBinding
that grants the API SA the role.

If your API is deployed to a namespace other than `modeldoctor`, edit
`RoleBinding.subjects[0].namespace` and the `ServiceAccount.metadata.namespace`
before applying.

```bash
kubectl apply -f deploy/k8s/rbac.yaml
```

Verify with:

```bash
kubectl -n modeldoctor-benchmarks describe role modeldoctor-benchmark-driver
kubectl -n modeldoctor-benchmarks describe rolebinding modeldoctor-benchmark-driver
kubectl auth can-i create jobs --as=system:serviceaccount:modeldoctor:modeldoctor-api -n modeldoctor-benchmarks
```

## Local k3d acceptance

```bash
k3d cluster create modeldoctor
kubectl create namespace modeldoctor
kubectl apply -f deploy/k8s/rbac.yaml

# Build the five runner images with the current source tree's git SHA and
# import them into k3d. The script prints the matching RUNNER_IMAGE_*
# tags to paste into your `.env` (one per tool).
./tools/build-runner-images.sh --import k3d --cluster modeldoctor
```

Then in your API env (paste the tags printed by the script):

```bash
# K8s is the only execution mode (#101) — no driver toggle.
export BENCHMARK_K8S_NAMESPACE=modeldoctor-benchmarks
export BENCHMARK_CALLBACK_URL=http://host.k3d.internal:3001
export RUNNER_IMAGE_GUIDELLM=md-runner-guidellm:<sha-from-script>
export RUNNER_IMAGE_VEGETA=md-runner-vegeta:<sha-from-script>
export RUNNER_IMAGE_PREFIX_CACHE_PROBE=md-runner-prefix-cache-probe:<sha-from-script>
export RUNNER_IMAGE_EVALSCOPE=md-runner-evalscope:<sha-from-script>
export RUNNER_IMAGE_AIPERF=md-runner-aiperf:<sha-from-script>
pnpm -F @modeldoctor/api start:dev
```

`host.k3d.internal` is how a pod inside the cluster reaches the dev machine
(use `host.docker.internal` if you're on kind + Docker Desktop). No tunnel
required.

## Report storage (MinIO / S3)

Phase 2 of #237 — the runner writes benchmark reports (`meta.json`,
`result.json`, `stdout.log`, `stderr.log`, output files) to a shared
S3-compatible bucket. The API reads them when the pod reaches its
terminal phase. The bucket and credentials must exist **before** the
API and runner Job can start.

### 1. Configure a bucket lifecycle (once per environment)

```bash
mc alias set myminio http://10.100.121.67:31871 <access-key> <secret-key>
mc ilm rule add --expire-days 30 myminio/<bucket>
```

30 days is the V1 retention. Adjust as ops sees fit; don't go shorter
than the longest expected benchmark duration plus a few hours of
investigation buffer.

### 2. Create the K8s Secret

The runner Job mounts `md-benchmark-storage` in the benchmarks namespace,
and the API reads the same values from its own pod env.

```bash
kubectl -n modeldoctor-benchmarks create secret generic md-benchmark-storage \
  --from-literal=S3_ENDPOINT=http://10.100.121.67:31871 \
  --from-literal=S3_ACCESS_KEY=<key> \
  --from-literal=S3_SECRET_KEY=<secret> \
  --from-literal=S3_BUCKET=<bucket> \
  --from-literal=S3_REGION=us-east-1

# Same Secret in the API namespace too (if different from modeldoctor-benchmarks):
kubectl -n modeldoctor create secret generic md-benchmark-storage --from-literal=...
```

The runner Job manifest auto-mounts this Secret via `envFrom`
(see `apps/api/src/modules/benchmark/k8s/k8s-job-manifest.ts`).

### 3. Verify with `mc`

```bash
mc ls myminio/<bucket>/   # should succeed
```

### Pre-deploy checklist (Phase 2 ramp)

- [ ] MinIO bucket exists with lifecycle configured
- [ ] `md-benchmark-storage` Secret exists in both namespaces
- [ ] No long-running in-flight benchmark when deploying (recommended;
      otherwise the watcher will auto-fail it after pod phase transitions
      since the old runner wrote no `result.json`)
- [ ] `K8S_WATCHER_MODE=primary` (this is now the env-schema default —
      no override needed)
