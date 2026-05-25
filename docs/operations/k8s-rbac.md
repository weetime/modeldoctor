# K8s RBAC for apps/api ServiceAccount

The api process needs RBAC permissions on the benchmark namespace
(default `modeldoctor-benchmarks`):

## Existing (Job lifecycle)

- `batch/jobs`: create, delete, patch
- `core/secrets`: create, delete, patch

## Added in Phase 1 (#237 — K8s watcher backstop)

- `core/pods`: **list, get, watch** — required by the Informer

## Reserved for Phase 3 (pod log streamer)

- `core/pods/log`: get — required by the per-pod log follower

## Sample ClusterRole

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: modeldoctor-api
rules:
  - apiGroups: ["batch"]
    resources: ["jobs"]
    verbs: ["create", "delete", "patch"]
  - apiGroups: [""]
    resources: ["secrets"]
    verbs: ["create", "delete", "patch"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["list", "get", "watch"]
```

Phase 1 deployments MUST update the role with the `pods` rule before
flipping `K8S_WATCHER_MODE` from `off` to `backstop`. Without it the
Informer will fail to list and the watcher will crash-loop logging RBAC
denials.
