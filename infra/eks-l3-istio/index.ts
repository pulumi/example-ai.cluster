import * as aws from '@pulumi/aws';
import * as k8s from '@pulumi/kubernetes';
import deepmerge from 'deepmerge';
import { clusterName, nodeSecurityGroupId } from '../lib/clusterByReference';

const cluster = aws.eks.getClusterOutput({
  name: clusterName,
});

const clusterSgId = cluster.vpcConfig.clusterSecurityGroupId;

new aws.vpc.SecurityGroupIngressRule(`istio-sidecar-webhook`, {
  securityGroupId: nodeSecurityGroupId,
  description: 'Istio Webhook namespace.sidecar-injector.istio.io',
  fromPort: 15017,
  toPort: 15017,
  ipProtocol: 'tcp',
  referencedSecurityGroupId: clusterSgId,
});

new aws.vpc.SecurityGroupIngressRule(`istio-cluster-api`, {
  securityGroupId: nodeSecurityGroupId,
  description: 'Istio Cluster API Server',
  fromPort: 15012,
  toPort: 15012,
  ipProtocol: 'tcp',
  referencedSecurityGroupId: clusterSgId,
});

const ns = new k8s.core.v1.NamespacePatch('istio-system', {
  metadata: {
    name: 'istio-system',
  },
});

const base = new k8s.helm.v3.Chart('istio-base', {
  path: '../../charts/istio-base',
  namespace: ns.metadata.name,
  skipAwait: true,
});

const nodeNotFargate = {
  matchExpressions: [
    {
      key: 'eks.amazonaws.com/compute-type',
      operator: 'NotIn',
      values: ['fargate'],
    },
  ],
};
const cni = new k8s.helm.v3.Chart(
  'istio-cni',
  {
    path: '../../charts/istio-cni',
    namespace: ns.metadata.name,
    skipAwait: true,
    values: {
      cni: {
        affinity: {
          nodeAffinity: {
            requiredDuringSchedulingIgnoredDuringExecution: {
              nodeSelectorTerms: [nodeNotFargate],
            },
          },
        },
        logLevel: 'info',
        privileged: true,
        ambient: {
          enabled: true,
        },
        excludeNamespaces: ['kube-system', 'karpenter'],
      },
    },
  },
  {
    dependsOn: base,
  },
);

const istiod = new k8s.helm.v3.Chart(
  'istiod',
  {
    path: '../../charts/istiod',
    namespace: ns.metadata.name,
    skipAwait: true,
    values: {
      pilot: {
        env: {
          VERIFY_CERTIFICATE_AT_CLIENT: 'true',
          ENABLE_AUTO_SNI: 'true',
          PILOT_ENABLE_HBONE: 'true',
          CA_TRUSTED_NODE_ACCOUNTS: 'istio-system/ztunnel,kube-system/ztunnel',
          PILOT_ENABLE_AMBIENT_CONTROLLERS: 'true',
        },
      },
      meshConfig: {
        accessLogFile: '/dev/stdout',
        defaultConfig: {
          proxyMetadata: {
            ISTIO_META_ENABLE_HBONE: 'true',
          },
        },
      },
      telemetry: {
        enabled: false,
        v2: {
          enabled: false,
        },
      },
      istio_cni: {
        enabled: true,
        chained: true,
      },
    },
  },
  {
    dependsOn: cni,
  },
);

new k8s.helm.v3.Chart(
  'ztunnel',
  {
    path: '../../charts/ztunnel',
    namespace: ns.metadata.name,
    skipAwait: true,
    transformations: [
      (obj: any) => {
        if (typeof obj === 'object' && 'kind' in obj && obj.kind === 'DaemonSet') {
          obj.spec = deepmerge(obj.spec, {
            template: {
              spec: {
                affinity: {
                  nodeAffinity: {
                    requiredDuringSchedulingIgnoredDuringExecution: {
                      nodeSelectorTerms: [nodeNotFargate],
                    },
                  },
                },
              },
            },
          });
        }
      },
    ],
  },
  {
    dependsOn: istiod,
  },
);
