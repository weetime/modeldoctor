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

# Build the three runner images with the current source tree's git SHA and
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
export RUNNER_IMAGE_GENAI_PERF=md-runner-genai-perf:<sha-from-script>
pnpm -F @modeldoctor/api start:dev
```

`host.k3d.internal` is how a pod inside the cluster reaches the dev machine
(use `host.docker.internal` if you're on kind + Docker Desktop). No tunnel
required.
