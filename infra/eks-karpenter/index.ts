import * as aws from '@pulumi/aws';
import * as k8s from '@pulumi/kubernetes';

import { clusterName, nodeSecurityGroupId } from '../lib/clusterByReference';
import { clusterPetName, clusterTags, karpenterNodeSecurityGroupTags } from '../lib/clusterIdentity';
import { IamServiceAccountRole } from '../lib/eks/IamServiceAccountRole';
import { privateSubnetTags } from '../lib/vpcTags';
import { newFargateProfile } from './fargateProfile';
import { karpenterControllerPolicy } from './karpenterControllerPolicy';

const fargateProfile = newFargateProfile({
  name: 'karpenter-nodes',
  selectors: [{ namespace: 'karpenter' }],
});

const karpenterInterruptionQueue = new aws.sqs.Queue(`${clusterPetName}-k7r-interruption-queue`, {
  messageRetentionSeconds: 300,
  sqsManagedSseEnabled: true,
});

const controllerRole = IamServiceAccountRole(`${clusterPetName}-k7r-controller`, {
  namespaceName: 'karpenter',
  serviceAccountName: 'karpenter',
});

const nodeRole = new aws.iam.Role(`${clusterPetName}-k7r-node`, {
  assumeRolePolicy: {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: {
          Service: 'ec2.amazonaws.com',
        },
        Action: 'sts:AssumeRole',
      },
    ],
  },
  forceDetachPolicies: true,
});

new aws.eks.AccessEntry(`${clusterPetName}-k7r-node`, {
  clusterName,
  principalArn: nodeRole.arn,
  type: 'EC2_LINUX',
});

const controllerPolicy = karpenterControllerPolicy({
  karpenterInterruptionQueueArn: karpenterInterruptionQueue.arn,
  nodeRole,
  controllerRole,
});

new aws.iam.RolePolicyAttachment(`${clusterPetName}-k7r-controller`, {
  role: controllerRole,
  policyArn: controllerPolicy.arn,
});

new aws.sqs.QueuePolicy(`${clusterPetName}-k7r-interruption-queue-policy`, {
  queueUrl: karpenterInterruptionQueue.id,
  policy: {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: {
          Service: ['events.amazonaws.com', 'sqs.amazonaws.com'],
        },
        Action: 'sqs:SendMessage',
        Resource: karpenterInterruptionQueue.arn,
      },
    ],
  },
});

function eventRule(name: string, source: string, detailType: string): void {
  const eventRule = new aws.cloudwatch.EventRule(`${clusterPetName}-k7r-${name}`, {
    description: `Karpenter ${name} event rule for cluster ${clusterPetName}`,
    eventPattern: JSON.stringify({
      source: [source],
      'detail-type': [detailType],
    }),
  });

  new aws.cloudwatch.EventTarget(`${clusterPetName}-k7r-${name}`, {
    rule: eventRule.name,
    arn: karpenterInterruptionQueue.arn,
  });
}

eventRule('scheduled-change', 'aws.health', 'AWS Health Event');
eventRule('spot-int', 'aws.ec2', 'EC2 Spot Instance Interruption Warning');
eventRule('rebalance', 'aws.ec2', 'EC2 Instance Rebalance Recommendation');
eventRule('instance-state', 'aws.ec2', 'EC2 Instance State-change Notification');

const namespace = new k8s.core.v1.Namespace('karpenter', {
  metadata: {
    name: 'karpenter',
    namespace: 'karpenter',
  },
});

const cluster = aws.eks.getClusterOutput({
  name: clusterName,
});

const sgPolicy = new k8s.apiextensions.CustomResource('karpenter-security-group-policy', {
  apiVersion: 'vpcresources.k8s.aws/v1beta1',
  kind: 'SecurityGroupPolicy',
  metadata: {
    name: 'karpenter',
    namespace: namespace.metadata.name,
  },
  spec: {
    podSelector: {
      matchLabels: {},
    },
    securityGroups: {
      groupIds: [nodeSecurityGroupId],
    },
  },
});

const chart = new k8s.helm.v3.Release(
  'karpenter',
  {
    namespace: namespace.metadata.name,
    skipAwait: true,
    chart: '../../charts/karpenter',
    version: '0.33.1',
    values: {
      dnsPolicy: 'Default', // Enable Karpenter nodes to use VPC DNS
      settings: {
        clusterName,
        clusterEndpoint: cluster.endpoint,
        interruptionQueueName: karpenterInterruptionQueue.name,
      },
      serviceAccount: {
        name: 'karpenter',
        annotations: {
          'eks.amazonaws.com/role-arn': controllerRole.arn,
        },
      },
      webhook: {
        enabled: false,
      },
      controller: {
        resources: {
          requests: {
            cpu: '0.25',
            memory: '756Mi',
          },
          limits: {
            cpu: '1',
            memory: '756Mi',
          },
        },
      },
    },
  },
  {
    dependsOn: [fargateProfile, sgPolicy],
  },
);

new aws.iam.RolePolicyAttachment(`${clusterPetName}-k7r-node`, {
  role: nodeRole,
  policyArn: aws.iam.ManagedPolicy.AmazonEKSWorkerNodePolicy,
});
new aws.iam.RolePolicyAttachment(`${clusterPetName}-k7r-node-cni`, {
  role: nodeRole,
  policyArn: aws.iam.ManagedPolicy.AmazonEKS_CNI_Policy,
});
new aws.iam.RolePolicyAttachment(`${clusterPetName}-k7r-node-ecr-read`, {
  role: nodeRole,
  policyArn: aws.iam.ManagedPolicy.AmazonEC2ContainerRegistryReadOnly,
});
new aws.iam.RolePolicyAttachment(`${clusterPetName}-k7r-node-managed-instance`, {
  role: nodeRole,
  policyArn: aws.iam.ManagedPolicy.AmazonSSMManagedInstanceCore,
});

const defaultNodesClass = new k8s.apiextensions.CustomResource(
  `default-node-class`,
  {
    apiVersion: 'karpenter.k8s.aws/v1beta1',
    kind: 'EC2NodeClass',
    metadata: {
      name: 'default-nodes',
    },
    spec: {
      tags: clusterTags,
      amiFamily: 'Bottlerocket',
      role: nodeRole.name,
      metadataOptions: {
        httpEndpoint: 'enabled',
        httpProtocolIPv6: 'disabled',
        // Block pod access to instance metadata, instance roles. This means pods must use IAM
        // Roles for Service Accounts (IRSA) or EKS Pod Identities.
        httpPutResponseHopLimit: 1,
        httpTokens: 'required',
      },
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
          // Application volume
          deviceName: '/dev/xvdb',
          ebs: {
            deleteOnTermination: true,
            volumeSize: '1000Gi',
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
  },
  {
    dependsOn: [chart],
  },
);

new k8s.apiextensions.CustomResource(
  'default-node-pool',
  {
    apiVersion: 'karpenter.sh/v1beta1',
    kind: 'NodePool',
    metadata: {
      name: 'default-nodes',
    },
    spec: {
      disruption: {
        consolidationPolicy: 'WhenUnderutilized',
      },
      limits: {
        cpu: 20,
        memory: '80Gi',
      },
      template: {
        metadata: {
          labels: {
            // https://github.com/aws/karpenter-provider-aws/issues/1252
            'vpc.amazonaws.com/has-trunk-attached': 'false',
          },
        },
        spec: {
          nodeClassRef: {
            name: defaultNodesClass.metadata.name,
          },
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
            // These instance types support trunking, which means they support pod network
            // security policies, per https://github.com/aws/amazon-vpc-resource-controller-k8s/blob/master/pkg/aws/vpc/limits.go
            {
              key: 'vpc.amazonaws.com/pod-eni',
              operator: 'Gt',
              // Ensure all nodes have sufficient room for a daemon set
              values: ['4'],
            },
            {
              key: 'karpenter.k8s.aws/instance-encryption-in-transit-supported',
              operator: 'In',
              values: ['true'],
            },
            {
              key: 'karpenter.k8s.aws/instance-category',
              operator: 'In',
              values: ['c', 'm', 'r'],
            },
            {
              key: 'karpenter.k8s.aws/instance-cpu',
              operator: 'In',
              values: ['4', '8', '16', '32'],
            },
            {
              key: 'karpenter.k8s.aws/instance-hypervisor',
              operator: 'In',
              values: ['nitro'],
            },
            {
              key: 'karpenter.k8s.aws/instance-generation',
              operator: 'Gt',
              values: ['4'],
            },
            {
              key: 'karpenter.sh/capacity-type',
              operator: 'In',
              values: ['on-demand'],
            },
          ],
        },
      },
    },
  },
  {
    dependsOn: [chart],
  },
);

export const karpenterNodeRoleName = nodeRole.name;
