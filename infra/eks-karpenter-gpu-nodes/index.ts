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

const gpuInstanceTypes = [
  {
    name: '8xA100',
    instance: 'p4d.24xlarge',
    quantity: 1,
    cpu: 96,
    memory: 1152,
    vram: 320,
    gpus: 8,
    onDemand: false,
  },
  {
    name: '8xA10',
    instance: 'g5.48xlarge',
    quantity: 1,
    cpu: 192,
    memory: 768,
    vram: 192,
    gpus: 8,
    onDemand: false,
  },
  {
    name: '4xA10',
    instance: 'g5.24xlarge',
    quantity: 2,
    cpu: 96,
    memory: 384,
    vram: 96,
    gpus: 4,
    onDemand: true,
  },
  {
    name: '1xA10',
    instance: 'g5.xlarge',
    quantity: 24,
    cpu: 4,
    memory: 16,
    vram: 24,
    onDemand: true,
  },
];

for (const spec of gpuInstanceTypes) {
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
        cpu: spec.cpu * (spec.quantity + 1) - 1,
        memory: `${spec.memory * (spec.quantity + 1) - 1}Gi`,
      },
      template: {
        metadata: {
          labels: {
            'eks.pulumi.com/gpu-layout': spec.name,
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
              key: 'eks.pulumi.com/gpu-workload-taint',
              value: 'nvidia',
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
              key: 'node.kubernetes.io/instance-type',
              operator: 'In',
              values: [spec.instance],
            },
            {
              key: 'karpenter.sh/capacity-type',
              operator: 'In',
              // About 1/7th the price
              values: spec.onDemand ? ['on-demand', 'spot'] : ['spot'],
            },
          ],
        },
      },
    },
  });
}

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

// const instanceConfigs = Object.fromEntries(
//   gpuInstanceTypes.map((spec) => {
//     return [
//       spec.name,
//       `\
//   version: v1
//   flags:
//     migStrategy: "none"
//     failOnInitError: true
//     nvidiaDriverRoot: "/"
//     plugin:
//       passDeviceSpecs: false
//       deviceListStrategy: envvar
//       deviceIDStrategy: uuid`,
//     ];
//   }),
// );

// new k8s.helm.v3.Chart('nvidia-device-plugin', {
//   path: '../../charts/nvidia-device-plugin',
//   skipAwait: true,
//   namespace: namespace.metadata.name,
//   values: {
//     config: {
//       map: {
//         ...instanceConfigs,
//         default: `\
// version: v1
// flags:
//   migStrategy: none`,
//       },
//     },
//     nodeSelector: {
//       'karpenter.k8s.aws/instance-gpu-manufacturer': 'nvidia',
//     },
//     tolerations: [
//       {
//         key: 'eks.pulumi.com/gpu-workload-taint',
//         operator: 'Equal',
//         value: 'nvidia',
//       },
//     ],
//   },
// });
