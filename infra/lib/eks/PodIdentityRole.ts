import * as aws from '@pulumi/aws';
import type * as pulumi from '@pulumi/pulumi';

interface PodIdentityRoleArgs {
  clusterName: pulumi.Input<string>;
  namespaceName: pulumi.Input<string>;
  serviceAccountName: pulumi.Input<string>;
}

export function PodIdentityRole(name: string, args: PodIdentityRoleArgs, opts?: pulumi.ResourceOptions): aws.iam.Role {
  const role = new aws.iam.Role(
    name,
    {
      assumeRolePolicy: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              Service: 'pods.eks.amazonaws.com',
            },
            Action: ['sts:AssumeRole', 'sts:TagSession'],
          },
        ],
      },
      forceDetachPolicies: true,
    },
    { ...opts },
  );

  new aws.eks.PodIdentityAssociation(name, {
    clusterName: args.clusterName,
    roleArn: role.arn,
    namespace: args.namespaceName,
    serviceAccount: args.serviceAccountName,
  });

  return role;
}
