import * as k8s from '@pulumi/kubernetes';
import * as pulumi from '@pulumi/pulumi';
import { clusterPetName } from '../lib/clusterIdentity';

const config = new pulumi.Config();

const ns = new k8s.core.v1.Namespace('llms');

const secretConfig = new k8s.core.v1.Secret('config', {
  metadata: {
    namespace: ns.metadata.name,
  },
  stringData: {
    HUGGING_FACE_HUB_TOKEN: config.requireSecret('huggingFaceHubToken'),
  },
});

// // See: https://huggingface.co/mistralai/Mixtral-8x7B-Instruct-v0.1/discussions/176/files
// for non-finetuned mixtral
// const chatTemplate =
//   "{{ bos_token }}{% for message in messages %}{% if (message['role'] == 'user') != (loop.index0 % 2 == 0) %}{{ raise_exception('Conversation roles must alternate user/assistant/user/assistant/...') }}{% endif %}{% if message['role'] == 'user' %}{{ ' [INST] ' + message['content'] + ' [/INST]' }}{% elif message['role'] == 'assistant' %}{{ ' ' + message['content'] + eos_token}}{% else %}{{ raise_exception('Only user and assistant roles are supported!') }}{% endif %}{% endfor %}";

const configMap = new k8s.core.v1.ConfigMap('vllm-config', {
  metadata: {
    namespace: ns.metadata.name,
  },
  data: {
    // 'chat-template.jinja': chatTemplate,
  },
});

const svc = new k8s.core.v1.Service('vllm', {
  metadata: {
    namespace: ns.metadata.name,
    annotations: {
      'pulumi.com/skipAwait': 'true',
    },
  },
  spec: {
    selector: {
      app: 'vllm',
    },
    ports: [
      {
        name: 'http',
        port: 8000,
        targetPort: 8000,
      },
    ],
  },
});

const pvc = new k8s.core.v1.PersistentVolumeClaim('vllm', {
  metadata: {
    namespace: ns.metadata.name,
    annotations: {
      'pulumi.com/skipAwait': 'true',
    },
  },
  spec: {
    accessModes: ['ReadWriteMany'],
    storageClassName: 'efs-sc',
    resources: {
      requests: {
        storage: '1Ti',
      },
    },
  },
});

new k8s.apps.v1.StatefulSet('vllm', {
  metadata: {
    namespace: ns.metadata.name,
    annotations: {
      'pulumi.com/skipAwait': 'true',
      'pulumi.com/patchForce': 'true',
    },
  },
  spec: {
    updateStrategy: {
      type: 'RollingUpdate',
      rollingUpdate: {
        maxUnavailable: '100%',
      },
    },
    replicas: 2,
    selector: {
      matchLabels: {
        app: 'vllm',
      },
    },
    serviceName: svc.metadata.name,
    template: {
      metadata: {
        labels: {
          app: 'vllm',
          'karpenter.sh/nodepool': 'gpu',
        },
      },
      spec: {
        containers: [
          {
            name: 'vllm-container',
            image: 'vllm/vllm-openai:latest',
            args: [
              '--host=0.0.0.0',
              '--scheduler-delay-factor=0.1',

              '--model=TheBloke/Nous-Hermes-2-Mixtral-8x7B-DPO-GPTQ',
              '--revision=gptq-8bit-128g-actorder_True',
              '--max-model-len=32768',
              '--tensor-parallel-size=4',
              '--enable-prefix-caching',
              '--dtype=half',
              '--load-format=safetensors',

              /*
              '--model=NousResearch/Hermes-2-Pro-Mistral-7B',
              '--tensor-parallel-size=2',
              '--max-model-len=8192',
              '--kv-cache-dtype=fp8_e5m2',
              '--load-format=safetensors',
               */
            ],
            envFrom: [
              {
                secretRef: { name: secretConfig.metadata.name },
              },
            ],
            ports: [
              {
                containerPort: 8000,
              },
            ],
            resources: {
              requests: {
                'nvidia.com/gpu': '4',
              },
              limits: {
                'nvidia.com/gpu': '4',
              },
            },
            volumeMounts: [
              // Ray needs a large shared memory space
              {
                name: 'dshm',
                mountPath: '/dev/shm',
              },
              {
                name: 'cache-volume',
                mountPath: '/root/.cache',
              },
              {
                name: 'vllm-config',
                mountPath: '/opt/vllm-config',
              },
            ],
            startupProbe: {
              httpGet: {
                path: '/v1/models',
                port: 8000,
              },
              periodSeconds: 10,
              failureThreshold: 90, // 900 seconds, 15 minutes
            },
            livenessProbe: {
              httpGet: {
                path: '/v1/models',
                port: 8000,
              },
              periodSeconds: 5,
              failureThreshold: 6,
            },
            readinessProbe: {
              httpGet: {
                path: '/v1/models',
                port: 8000,
              },
              periodSeconds: 5,
              failureThreshold: 2,
            },
          },
        ],
        terminationGracePeriodSeconds: 10,
        nodeSelector: {
          'karpenter.k8s.aws/instance-gpu-manufacturer': 'nvidia',
        },
        tolerations: [
          {
            key: 'eks.pulumi.com/gpu-workload-taint',
            operator: 'Exists',
          },
        ],
        volumes: [
          {
            name: 'dshm',
            emptyDir: {
              medium: 'Memory',
            },
          },
          {
            name: 'cache-volume',
            persistentVolumeClaim: {
              claimName: pvc.metadata.name,
            },
          },
          {
            name: 'vllm-config',
            configMap: {
              name: configMap.metadata.name,
            },
          },
        ],
      },
    },
  },
});

const ingress = new k8s.networking.v1.Ingress('vllm-alb', {
  kind: 'Ingress',
  metadata: {
    namespace: ns.metadata.name,
    annotations: svc.metadata.name.apply((serviceName) => ({
      'kubernetes.io/ingress.class': 'alb',
      'alb.ingress.kubernetes.io/scheme': 'internet-facing',
      'alb.ingress.kubernetes.io/listen-ports': '[{"HTTP": 80},{"HTTPS":443}]',
      'alb.ingress.kubernetes.io/target-type': 'ip',
      'alb.ingress.kubernetes.io/ssl-redirect': '443',
      'alb.ingress.kubernetes.io/success-codes': '200-499',
      'alb.ingress.kubernetes.io/target-group-attributes': 'load_balancing.algorithm.type=least_outstanding_requests',
      [`alb.ingress.kubernetes.io/conditions.${serviceName}`]: JSON.stringify([
        { field: 'http-header', httpHeaderConfig: { httpHeaderName: 'x-pulumi', values: ['hack-fy24q4'] } },
      ]),
    })),
  },
  spec: {
    tls: [
      {
        hosts: [`vllm.${clusterPetName}.pulumi-demos.net`],
      },
    ],
    rules: [
      {
        host: `vllm.${clusterPetName}.pulumi-demos.net`,
        http: {
          paths: [
            {
              pathType: 'Prefix',
              path: '/',
              backend: {
                service: {
                  name: svc.metadata.name,
                  port: {
                    name: 'http',
                  },
                },
              },
            },
          ],
        },
      },
    ],
  },
});

export const lb = ingress.status.apply((status) => status?.loadBalancer?.ingress?.[0]?.hostname ?? status?.loadBalancer?.ingress?.[0]?.ip);
