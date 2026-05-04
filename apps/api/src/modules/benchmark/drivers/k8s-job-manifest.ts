import type { V1Job, V1Secret } from "@kubernetes/client-node";
import type { RunExecutionContext } from "./execution-driver.interface.js";

export function jobName(runId: string): string {
  return `run-${runId}`;
}
export function secretName(runId: string): string {
  return jobName(runId);
}

const LABELS = {
  "app.kubernetes.io/name": "modeldoctor-run",
  "app.kubernetes.io/managed-by": "modeldoctor-api",
};

// Encode an inputFiles alias into a Secret-key-safe form. Aliases are
// arbitrary strings (e.g. "targets.txt"); Secret keys must be DNS-
// segment-like ([A-Za-z0-9._-]). Base64-url-no-pad gives a deterministic
// encoding inside that set.
function encodeAlias(alias: string): string {
  return `INPUT_FILE_${Buffer.from(alias, "utf8").toString("base64url")}`;
}
function decodeAlias(key: string): string | null {
  if (!key.startsWith("INPUT_FILE_")) return null;
  return Buffer.from(key.slice("INPUT_FILE_".length), "base64url").toString("utf8");
}
export const __testing = { encodeAlias, decodeAlias };

const INPUTS_VOLUME = "input-files";
const INPUTS_MOUNT_PATH = "/workdir/inputs";

export function buildSecretManifest(ctx: RunExecutionContext, namespace: string): V1Secret {
  const stringData: Record<string, string> = {
    ...ctx.buildResult.secretEnv,
    MD_CALLBACK_TOKEN: ctx.callback.token,
  };
  for (const [alias, content] of Object.entries(ctx.buildResult.inputFiles ?? {})) {
    stringData[encodeAlias(alias)] = content;
  }
  return {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: secretName(ctx.runId),
      namespace,
      labels: { ...LABELS, "modeldoctor.ai/run-id": ctx.runId },
    },
    type: "Opaque",
    stringData,
  };
}

export interface JobManifestOptions {
  namespace: string;
}

export function buildJobManifest(ctx: RunExecutionContext, opts: JobManifestOptions): V1Job {
  const env: { name: string; value: string }[] = [
    { name: "MD_RUN_ID", value: ctx.runId },
    { name: "MD_CALLBACK_URL", value: ctx.callback.url },
    { name: "MD_ARGV", value: JSON.stringify(ctx.buildResult.argv) },
    { name: "MD_OUTPUT_FILES", value: JSON.stringify(ctx.buildResult.outputFiles) },
  ];
  // Map alias → full path of the mounted Secret key
  const inputFilePaths: Record<string, string> = {};
  for (const alias of Object.keys(ctx.buildResult.inputFiles ?? {})) {
    inputFilePaths[alias] = `${INPUTS_MOUNT_PATH}/${encodeAlias(alias)}`;
  }
  if (Object.keys(inputFilePaths).length > 0) {
    env.push({ name: "MD_INPUT_FILE_PATHS", value: JSON.stringify(inputFilePaths) });
  }
  for (const [k, v] of Object.entries(ctx.buildResult.env)) {
    env.push({ name: k, value: v });
  }

  const hasInputFiles = Object.keys(ctx.buildResult.inputFiles ?? {}).length > 0;

  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      name: jobName(ctx.runId),
      namespace: opts.namespace,
      labels: { ...LABELS, "modeldoctor.ai/run-id": ctx.runId },
    },
    spec: {
      backoffLimit: 0,
      ttlSecondsAfterFinished: 3600,
      template: {
        metadata: {
          labels: { ...LABELS, "modeldoctor.ai/run-id": ctx.runId },
        },
        spec: {
          restartPolicy: "Never",
          containers: [
            {
              name: "runner",
              image: ctx.image,
              imagePullPolicy: "IfNotPresent",
              env,
              envFrom: [{ secretRef: { name: secretName(ctx.runId) } }],
              ...(hasInputFiles
                ? {
                    volumeMounts: [
                      {
                        name: INPUTS_VOLUME,
                        mountPath: INPUTS_MOUNT_PATH,
                        readOnly: true,
                      },
                    ],
                  }
                : {}),
              resources: {
                requests: { cpu: "500m", memory: "512Mi" },
                limits: { cpu: "2", memory: "2Gi" },
              },
            },
          ],
          ...(hasInputFiles
            ? {
                volumes: [
                  {
                    name: INPUTS_VOLUME,
                    secret: { secretName: secretName(ctx.runId) },
                  },
                ],
              }
            : {}),
        },
      },
    },
  };
}
