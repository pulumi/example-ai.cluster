import * as k8s from '@pulumi/kubernetes';
import * as pulumi from '@pulumi/pulumi';

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

new k8s.apps.v1.Deployment('vllm', {
  metadata: {
    namespace: ns.metadata.name,
    annotations: {
      'pulumi.com/skipAwait': 'true',
    },
  },
  spec: {
    replicas: 1,
    selector: {
      matchLabels: {
        app: 'vllm',
      },
    },
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
            args: ['--model', 'mistralai/Mistral-7B-Instruct-v0.2', '--max-model-len', '8192'],
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
              limits: {
                'nvidia.com/gpu': '1',
              },
            },
            volumeMounts: [
              {
                name: 'cache-volume',
                mountPath: '/root/.cache/huggingface',
              },
            ],
          },
        ],
        nodeSelector: {
          'eks.pulumi.com/gpu': 'nvidia',
        },
        tolerations: [
          {
            key: 'nvidia.com/gpu',
            operator: 'Exists',
            effect: 'NoSchedule',
          },
        ],
        volumes: [
          {
            name: 'cache-volume',
            emptyDir: {},
          },
        ],
      },
    },
  },
});

const svc = new k8s.core.v1.Service('vllm', {
  metadata: {
    namespace: ns.metadata.name,
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

const ingress = new k8s.networking.v1.Ingress('vllm-alb', {
  kind: 'Ingress',
  metadata: {
    namespace: ns.metadata.name,
    name: 'ingress',
    annotations: svc.metadata.name.apply((serviceName) => ({
      'kubernetes.io/ingress.class': 'alb',
      'alb.ingress.kubernetes.io/scheme': 'internet-facing',
      'alb.ingress.kubernetes.io/target-type': 'ip',
      [`alb.ingress.kubernetes.io/conditions.${serviceName}`]: JSON.stringify([
        { field: 'http-header', httpHeaderConfig: { httpHeaderName: 'x-pulumi', values: ['hack-fy24q4'] } },
      ]),
    })),
  },
  spec: {
    rules: [
      {
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
