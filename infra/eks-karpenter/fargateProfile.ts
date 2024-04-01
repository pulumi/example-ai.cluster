import * as aws from '@pulumi/aws';
import type * as pulumi from '@pulumi/pulumi';

import { clusterName } from '../lib/clusterByReference';
import { clusterPetName } from '../lib/clusterIdentity';
import { privateSubnetIds } from '../lib/vpcByReference';

export function newFargateProfile({
  name,
  selectors,
}: {
  name: string;
  selectors: pulumi.Input<Array<pulumi.Input<aws.types.input.eks.FargateProfileSelector>>>;
}): aws.eks.FargateProfile {
  const fargateRole = new aws.iam.Role(`${clusterPetName}-fargate-${name}`, {
    assumeRolePolicy: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'sts:AssumeRole',
          Principal: {
            Service: ['eks-fargate-pods.amazonaws.com'],
          },
          Effect: 'Allow',
        },
      ],
    },
    forceDetachPolicies: true,
  });

  new aws.iam.RolePolicyAttachment(`${clusterPetName}-fargate-${name}-eks-for-fargate`, {
    role: fargateRole,
    policyArn: aws.iam.ManagedPolicy.AmazonEKSFargatePodExecutionRolePolicy,
  });

  new aws.iam.RolePolicyAttachment(`${clusterPetName}-fargate-${name}-ecr-read-only`, {
    role: fargateRole,
    policyArn: aws.iam.ManagedPolicy.AmazonEC2ContainerRegistryReadOnly,
  });

  new aws.iam.RolePolicyAttachment(`${clusterPetName}-fargate-${name}-eks-cni`, {
    role: fargateRole,
    policyArn: aws.iam.ManagedPolicy.AmazonEKS_CNI_Policy,
  });

  const loggingPolicy = new aws.iam.Policy(`${clusterPetName}-fargate-${name}-logging`, {
    policy: {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: [
            'logs:CreateLogStream',
            'logs:CreateLogGroup',
            'logs:DescribeLogStreams',
            'logs:PutLogEvents',
            'logs:PutRetentionPolicy',
          ],
          Resource: ['*'],
        },
      ],
    },
  });

  new aws.iam.RolePolicyAttachment(`${clusterPetName}-fargate-${name}-logging`, {
    role: fargateRole,
    policyArn: loggingPolicy.arn,
  });

  new aws.eks.AccessEntry(`${clusterPetName}-fargate-${name}`, {
    clusterName,
    principalArn: fargateRole.arn,
    type: 'FARGATE_LINUX',
  });

  // work around "eks-" being an invalid prefix
  return new aws.eks.FargateProfile(`${name}-${clusterPetName}`, {
    clusterName,
    podExecutionRoleArn: fargateRole.arn,
    subnetIds: privateSubnetIds,
    selectors,
  });
}
