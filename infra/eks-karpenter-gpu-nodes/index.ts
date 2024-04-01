import * as k8s from '@pulumi/kubernetes';
import * as pulumi from '@pulumi/pulumi';
import { clusterTags, karpenterNodeSecurityGroupTags } from '../lib/clusterIdentity';
import { privateSubnetTags } from '../lib/vpcTags';

const stackName = pulumi.getStack();
const org = pulumi.getOrganization();

const karpenterStack = new pulumi.StackReference('cluster', {
  name: `${org}/pulumi-ai-eks-karpenter/${stackName}`,
});

const karpenterNodeRoleName = karpenterStack.requireOutput('karpenterNodeRoleName');

const instanceFamilies = [
  {
    name: '8xA100',
    family: 'p4d',
    // Up to 1 x p4d.24xlarge
    quantity: 1,
    cpu: 96,
    memory: 1152,
    vram: 320,
    gpus: 8,
  },
  {
    name: '8xA10',
    family: 'g5',
    // Up to 1 x g5.48xlarge
    quantity: 1,
    cpu: 192,
    memory: 768,
    vram: 192,
    gpus: 8,
  },
  {
    name: '4xA10',
    family: 'g5',
    // Up to 1 x g5.24xlarge
    quantity: 1,
    cpu: 96,
    memory: 384,
    vram: 96,
    gpus: 4,
  },
  {
    name: '1xA10',
    family: 'g5',
    // Up to 2 x g5.16xlarge
    quantity: 2,
    cpu: 128,
    memory: 256,
    vram: 24,
    gpus: 1,
  },
];

for (const spec of instanceFamilies) {
  new k8s.apiextensions.CustomResource(`gpu-${spec.name}`, {
    apiVersion: 'karpenter.sh/v1beta1',
    kind: 'NodePool',
    metadata: {
      name: `gpu-${spec.name}`.toLowerCase(),
    },
    spec: {
      disruption: {
        consolidationPolicy: 'WhenUnderutilized',
      },
      limits: {
        cpu: spec.cpu * spec.quantity,
        memory: `${spec.memory * spec.quantity}Gi`,
        'nvidia.com/gpu': spec.gpus * spec.quantity,
      },
      template: {
        metadata: {
          labels: {
            'eks.pulumi.com/gpu': 'nvidia',
            'nvidia.com/device-plugin.config': spec.name,
            'vpc.amazonaws.com/has-trunk-attached': 'false',
          },
        },
        spec: {
          nodeClassRef: {
            name: 'gpu-nodes',
          },
          taints: [
            {
              key: 'nvidia.com/gpu',
              value: 'true',
              effect: 'NoSchedule',
            },
          ],
          requirements: [
            {
              key: 'kubernetes.io/arch',
              operator: 'In',
              values: ['amd64'],
            },
            {
              key: 'kubernetes.io/os',
              operator: 'In',
              values: ['linux'],
            },
            {
              key: 'karpenter.k8s.aws/instance-family',
              operator: 'In',
              values: [spec.family],
            },
            {
              key: 'karpenter.k8s.aws/instance-gpu-count',
              operator: 'In',
              values: [`${spec.gpus}`],
            },
            {
              key: 'karpenter.sh/capacity-type',
              operator: 'In',
              // About 1/7th the price
              values: ['spot'],
            },
          ],
        },
      },
    },
  });
}

const namespace = new k8s.core.v1.Namespace('nvidia-admin', {});

new k8s.apiextensions.CustomResource(`gpu-node-class`, {
  apiVersion: 'karpenter.k8s.aws/v1beta1',
  kind: 'EC2NodeClass',
  metadata: {
    name: 'gpu-nodes',
  },
  spec: {
    tags: clusterTags,
    amiFamily: 'Bottlerocket',
    role: karpenterNodeRoleName,

    blockDeviceMappings: [
      {
        // Root volume
        deviceName: '/dev/xvda',
        ebs: {
          deleteOnTermination: true,
          volumeSize: '4Gi',
          volumeType: 'gp3',
          encrypted: true,
        },
      },
      {
        deviceName: '/dev/xvdb',
        ebs: {
          deleteOnTermination: true,
          volumeSize: '4000Gi',
          volumeType: 'gp3',
          encrypted: true,
        },
      },
    ],
    subnetSelectorTerms: [
      {
        tags: privateSubnetTags,
      },
    ],
    securityGroupSelectorTerms: [
      {
        tags: karpenterNodeSecurityGroupTags,
      },
    ],
  },
});

const instanceConfigs = Object.fromEntries(
  instanceFamilies.map((spec) => {
    return [
      spec.name,
      `\
  version: v1
  flags:
    migStrategy: "none"
    failOnInitError: true
    nvidiaDriverRoot: "/"
    plugin:
      passDeviceSpecs: false
      deviceListStrategy: envvar
      deviceIDStrategy: uuid
  sharing:
    timeSlicing:
      renameByDefault: false
      resources:
      - name: nvidia.com/gpu
        replicas: ${spec.gpus * 8}`,
    ];
  }),
);

new k8s.helm.v3.Chart('nvidia-device-plugin', {
  path: '../../charts/nvidia-device-plugin',
  skipAwait: true,
  namespace: namespace.metadata.name,
  values: {
    config: {
      map: {
        ...instanceConfigs,
        default: `\
version: v1
flags:
  migStrategy: none`,
      },
    },
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
  },
});
