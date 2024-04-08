import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { oidcProviderArn, oidcProviderUrl } from '../clusterByReference';

interface IamServiceAccountRoleArgs {
  namespaceName: pulumi.Input<string>;
  serviceAccountName: pulumi.Input<string>;
  serviceAccountNameTest?: 'StringEquals' | 'StringLike';
}

export function IamServiceAccountRole(name: string, args: IamServiceAccountRoleArgs, opts?: pulumi.ResourceOptions): aws.iam.Role {
  const trustDocument = aws.iam.getPolicyDocumentOutput({
    statements: [
      {
        sid: 'AllowAssumeRoleWithWebIdentity',
        actions: ['sts:AssumeRoleWithWebIdentity'],
        effect: 'Allow',
        conditions: [
          {
            test: 'StringEquals',
            variable: pulumi.interpolate`${oidcProviderUrl}:aud`,
            values: ['sts.amazonaws.com'],
          },
          {
            test: args.serviceAccountNameTest ?? 'StringEquals',
            variable: pulumi.interpolate`${oidcProviderUrl}:sub`,
            values: [pulumi.interpolate`system:serviceaccount:${args.namespaceName}:${args.serviceAccountName}`],
          },
        ],
        principals: [
          {
            type: 'Federated',
            identifiers: [oidcProviderArn],
          },
        ],
      },
    ],
  });

  return new aws.iam.Role(
    name,
    {
      assumeRolePolicy: trustDocument.json,
      forceDetachPolicies: true,
    },
    { ...opts },
  );
}
