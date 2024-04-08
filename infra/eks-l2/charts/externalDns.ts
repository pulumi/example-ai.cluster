import * as aws from '@pulumi/aws';
import * as k8s from '@pulumi/kubernetes';
import * as pulumi from '@pulumi/pulumi';
import * as random from '@pulumi/random';

import { clusterName } from '../../lib/clusterByReference';
import { clusterPetName } from '../../lib/clusterIdentity';
import { PodIdentityRole } from '../../lib/eks/PodIdentityRole';

export function externalDnsChart({ zone, dependsOn = [] }: { zone: aws.route53.Zone; dependsOn?: pulumi.Resource[] }): k8s.helm.v3.Chart {
  const suffix = new random.RandomBytes('external-dns-suffix', { length: 8 }).hex;
  const saName = pulumi.interpolate`external-dns-${suffix}`;
  const externalDnsRole = PodIdentityRole(`${clusterPetName}-external-dns-role`, {
    clusterName,
    namespaceName: 'kube-system',
    serviceAccountName: saName,
  });

  const externalDnsPolicy = new aws.iam.Policy(`${clusterPetName}-external-dns-policy`, {
    description: `Policy for EKS cluster '${clusterPetName}' external-dns`,
    policy: {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: ['route53:ChangeResourceRecordSets'],
          Resource: [pulumi.interpolate`arn:aws:route53:::hostedzone/${zone.zoneId}`],
        },
        {
          Effect: 'Allow',
          Action: ['route53:ListHostedZones', 'route53:ListResourceRecordSets', 'route53:ListTagsForResource'],
          Resource: ['*'],
        },
      ],
    },
  });

  const externalDnsPolicies = [
    new aws.iam.RolePolicyAttachment(`${clusterPetName}-external-dns-policy-attachment`, {
      role: externalDnsRole,
      policyArn: externalDnsPolicy.arn,
    }),
  ];

  const externalDnsServiceAccount = new k8s.core.v1.ServiceAccount(
    `external-dns-sa`,
    {
      metadata: {
        name: saName,
        namespace: 'kube-system',
        annotations: {
          'eks.amazonaws.com/role-arn': externalDnsRole.arn,
        },
      },
    },
    { dependsOn: externalDnsPolicies, deleteBeforeReplace: true },
  );

  const ownerId = new random.RandomId('external-dns-owner-id', {
    byteLength: 8,
  }).hex;

  return new k8s.helm.v3.Chart(
    `external-dns`,
    {
      path: '../../charts/external-dns',
      namespace: 'kube-system',
      skipAwait: true,
      values: {
        serviceAccount: {
          create: false,
          name: externalDnsServiceAccount.metadata.name,
        },
        provider: {
          name: 'aws',
        },
        domainFilters: [zone.name],
        txtOwnerId: ownerId,
        extraArgs: ['--aws-zone-type=public'],
        env: [
          {
            name: 'AWS_DEFAULT_REGION',
            value: aws.config.requireRegion(),
          },
        ],
      },
    },
    { dependsOn: [...externalDnsPolicies, ...dependsOn] },
  );
}
