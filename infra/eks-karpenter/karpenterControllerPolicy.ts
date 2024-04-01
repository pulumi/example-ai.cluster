import * as aws from '@pulumi/aws';
import { type PolicyStatement } from '@pulumi/aws/iam/documents';
import * as pulumi from '@pulumi/pulumi';

import { clusterPetName } from '../lib/clusterIdentity';
import { clusterName } from '../lib/clusterByReference';

export function karpenterControllerPolicy({
  karpenterInterruptionQueueArn,
  nodeRole,
  controllerRole,
}: {
  karpenterInterruptionQueueArn: pulumi.Input<string>;
  nodeRole: aws.iam.Role;
  controllerRole: aws.iam.Role;
}): aws.iam.Policy {
  const awsAccountId = aws.getCallerIdentity().then((identity) => identity.accountId);
  const awsRegion = aws.config.region;
  const awsPartition = 'aws';

  const ec2Arn = pulumi.interpolate`arn:${awsPartition}:ec2:${awsRegion}`;

  const controllerPolicy = new aws.iam.Policy(`${clusterPetName}-k7r-controller`, {
    policy: {
      Version: '2012-10-17',
      Statement: pulumi.output(clusterName).apply((clusterName): PolicyStatement[] => [
        {
          Sid: 'AllowScopedEC2InstanceAccessActions',
          Effect: 'Allow',
          Resource: [
            pulumi.interpolate`${ec2Arn}::image/*`,
            pulumi.interpolate`${ec2Arn}::snapshot/*`,
            pulumi.interpolate`${ec2Arn}:*:security-group/*`,
            pulumi.interpolate`${ec2Arn}:*:subnet/*`,
            pulumi.interpolate`${ec2Arn}:*:launch-template/*`,
          ],
          Action: ['ec2:RunInstances', 'ec2:CreateFleet'],
        },
        {
          Sid: 'AllowScopedEC2LaunchTemplateAccessActions',
          Effect: 'Allow',
          Resource: [pulumi.interpolate`${ec2Arn}:*:launch-template/*`],
          Action: ['ec2:RunInstances', 'ec2:CreateFleet'],
          Condition: {
            StringEquals: {
              [`aws:RequestTag/kubernetes.io/cluster/${clusterName}`]: 'owned',
            },
            StringLike: {
              'aws:RequestTag/karpenter.sh/nodepool': '*',
            },
          },
        },
        {
          Sid: 'AllowScopedEC2InstanceActionsWithTags',
          Effect: 'Allow',
          Resource: [
            pulumi.interpolate`${ec2Arn}:*:fleet/*`,
            pulumi.interpolate`${ec2Arn}:*:instance/*`,
            pulumi.interpolate`${ec2Arn}:*:volume/*`,
            pulumi.interpolate`${ec2Arn}:*:network-interface/*`,
            pulumi.interpolate`${ec2Arn}:*:launch-template/*`,
            pulumi.interpolate`${ec2Arn}:*:spot-instances-request/*`,
          ],
          Action: ['ec2:RunInstances', 'ec2:CreateFleet', 'ec2:CreateLaunchTemplate'],
          Condition: {
            StringEquals: {
              [`aws:RequestTag/kubernetes.io/cluster/${clusterName}`]: 'owned',
            },
            StringLike: {
              'aws:RequestTag/karpenter.sh/nodepool': '*',
            },
          },
        },
        {
          Sid: 'AllowScopedResourceCreationTagging',
          Effect: 'Allow',
          Resource: [
            pulumi.interpolate`${ec2Arn}:*:fleet/*`,
            pulumi.interpolate`${ec2Arn}:*:instance/*`,
            pulumi.interpolate`${ec2Arn}:*:volume/*`,
            pulumi.interpolate`${ec2Arn}:*:network-interface/*`,
            pulumi.interpolate`${ec2Arn}:*:launch-template/*`,
            pulumi.interpolate`${ec2Arn}:*:spot-instances-request/*`,
          ],
          Action: 'ec2:CreateTags',
          Condition: {
            StringEquals: {
              [`aws:RequestTag/kubernetes.io/cluster/${clusterName}`]: 'owned',
              'ec2:CreateAction': ['RunInstances', 'CreateFleet', 'CreateLaunchTemplate'],
            },
            StringLike: {
              'aws:RequestTag/karpenter.sh/nodepool': '*',
            },
          },
        },
        {
          Sid: 'AllowScopedResourceTagging',
          Effect: 'Allow',
          Resource: pulumi.interpolate`${ec2Arn}:*:instance/*`,
          Action: 'ec2:CreateTags',
          Condition: {
            StringEquals: {
              [`aws:ResourceTag/kubernetes.io/cluster/${clusterName}`]: 'owned',
            },
            StringLike: {
              'aws:ResourceTag/karpenter.sh/nodepool': '*',
            },
            'ForAllValues:StringEquals': {
              'aws:TagKeys': ['karpenter.sh/nodeclaim', 'Name'],
            },
          },
        },
        {
          Sid: 'AllowScopedDeletion',
          Effect: 'Allow',
          Resource: [pulumi.interpolate`${ec2Arn}:*:instance/*`, pulumi.interpolate`${ec2Arn}:*:launch-template/*`],
          Action: ['ec2:TerminateInstances', 'ec2:DeleteLaunchTemplate'],
          Condition: {
            StringEquals: {
              [`aws:ResourceTag/kubernetes.io/cluster/${clusterName}`]: 'owned',
            },
            StringLike: {
              'aws:ResourceTag/karpenter.sh/nodepool': '*',
            },
          },
        },
        {
          Sid: 'AllowRegionalReadActions',
          Effect: 'Allow',
          Resource: '*',
          Action: [
            'ec2:DescribeAvailabilityZones',
            'ec2:DescribeImages',
            'ec2:DescribeInstances',
            'ec2:DescribeInstanceTypeOfferings',
            'ec2:DescribeInstanceTypes',
            'ec2:DescribeLaunchTemplates',
            'ec2:DescribeSecurityGroups',
            'ec2:DescribeSpotPriceHistory',
            'ec2:DescribeSubnets',
          ],
          Condition: {
            StringEquals: {
              'aws:RequestedRegion': `${awsRegion}`,
            },
          },
        },
        {
          Sid: 'AllowSSMReadActions',
          Effect: 'Allow',
          Resource: `arn:${awsPartition}:ssm:${awsRegion}::parameter/aws/service/*`,
          Action: ['ssm:GetParameter'],
        },
        {
          Sid: 'AllowPricingReadActions',
          Effect: 'Allow',
          Resource: '*',
          Action: ['pricing:GetProducts'],
        },
        {
          Sid: 'AllowInterruptionQueueActions',
          Effect: 'Allow',
          Resource: karpenterInterruptionQueueArn,
          Action: ['sqs:DeleteMessage', 'sqs:GetQueueAttributes', 'sqs:GetQueueUrl', 'sqs:ReceiveMessage'],
        },
        {
          Sid: 'AllowPassingInstanceRole',
          Effect: 'Allow',
          Resource: nodeRole.arn,
          Action: 'iam:PassRole',
          Condition: {
            StringEquals: {
              'iam:PassedToService': 'ec2.amazonaws.com',
            },
          },
        },

        {
          Sid: 'AllowScopedInstanceProfileCreationActions',
          Effect: 'Allow',
          Resource: '*',
          Action: ['iam:CreateInstanceProfile'],
          Condition: {
            StringEquals: {
              [`aws:RequestTag/kubernetes.io/cluster/${clusterName}`]: 'owned',
              'aws:RequestTag/topology.kubernetes.io/region': `${awsRegion}`,
            },
            StringLike: {
              'aws:RequestTag/karpenter.k8s.aws/ec2nodeclass': '*',
            },
          },
        },

        {
          Sid: 'AllowScopedInstanceProfileTagActions',
          Effect: 'Allow',
          Resource: '*',
          Action: ['iam:TagInstanceProfile'],
          Condition: {
            StringEquals: {
              [`aws:ResourceTag/kubernetes.io/cluster/${clusterName}`]: 'owned',
              'aws:ResourceTag/topology.kubernetes.io/region': `${awsRegion}`,
              [`aws:RequestTag/kubernetes.io/cluster/${clusterName}`]: 'owned',
              'aws:RequestTag/topology.kubernetes.io/region': `${awsRegion}`,
            },
            StringLike: {
              'aws:ResourceTag/karpenter.k8s.aws/ec2nodeclass': '*',
              'aws:RequestTag/karpenter.k8s.aws/ec2nodeclass': '*',
            },
          },
        },
        {
          Sid: 'AllowScopedInstanceProfileActions',
          Effect: 'Allow',
          Resource: '*',
          Action: ['iam:AddRoleToInstanceProfile', 'iam:RemoveRoleFromInstanceProfile', 'iam:DeleteInstanceProfile'],
          Condition: {
            StringEquals: {
              [`aws:ResourceTag/kubernetes.io/cluster/${clusterName}`]: 'owned',
              'aws:ResourceTag/topology.kubernetes.io/region': `${awsRegion}`,
            },
            StringLike: {
              'aws:ResourceTag/karpenter.k8s.aws/ec2nodeclass': '*',
            },
          },
        },
        {
          Sid: 'AllowInstanceProfileReadActions',
          Effect: 'Allow',
          Resource: '*',
          Action: 'iam:GetInstanceProfile',
        },
        {
          Sid: 'AllowAPIServerEndpointDiscovery',
          Effect: 'Allow',
          Resource: pulumi.interpolate`arn:${awsPartition}:eks:${awsRegion}:${awsAccountId}:cluster/${clusterName}`,
          Action: 'eks:DescribeCluster',
        },
      ]),
    },
  });

  return controllerPolicy;
}
