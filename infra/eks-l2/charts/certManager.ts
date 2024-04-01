import * as aws from '@pulumi/aws';
import * as k8s from '@pulumi/kubernetes';
import * as pulumi from '@pulumi/pulumi';
import * as random from '@pulumi/random';

import { clusterName } from '../../lib/clusterByReference';
import { clusterPetName } from '../../lib/clusterIdentity';
import { PodIdentityRole } from '../../lib/eks/PodIdentityRole';

export function certManagerChart({ dependsOn = [] }: { dependsOn?: pulumi.Resource[] }): k8s.helm.v3.Chart {
  const suffix = new random.RandomBytes('cert-manager-suffix', { length: 8 }).hex;
  const saName = pulumi.interpolate`cert-manager-${suffix}`;
  const certManagerRole = PodIdentityRole(`${clusterPetName}-cert-manager-role`, {
    clusterName,
    namespaceName: 'kube-system',
    serviceAccountName: saName,
  });

  const certManagerPolicyDocument = aws.iam.getPolicyDocumentOutput({
    statements: [
      {
        sid: 'AllowAccessToRoute53Changes',
        actions: ['route53:GetChange'],
        effect: 'Allow',
        resources: ['arn:aws:route53:::change/*'],
      },
      // TODO: Restrict access to specific hosted zones
      // {
      //   sid: 'AllowAccessToRoute53HostedZones',
      //   actions: ['route53:ChangeResourceRecordSets', 'route53:ListResourceRecordSets'],
      //   effect: 'Allow',
      //   resources: ['arn:aws:route53:::hostedzone/*'],
      // },
      {
        sid: 'AllowAccessToRoute53HostedZones',
        actions: ['route53:ChangeResourceRecordSets', 'route53:ListResourceRecordSets'],
        effect: 'Allow',
        resources: ['arn:aws:route53:::hostedzone/*'],
      },
      {
        sid: 'AllowListingHostedZones',
        actions: ['route53:ListHostedZonesByName'],
        effect: 'Allow',
        resources: ['*'],
      },
    ],
  });

  const certManagerPolicy = new aws.iam.Policy(`${clusterPetName}-cert-manager-policy`, {
    description: `Policy for EKS cluster '${clusterPetName}' cert-manager`,
    policy: certManagerPolicyDocument.json,
  });

  const certManagerPolicies = [
    new aws.iam.RolePolicyAttachment(`${clusterPetName}-cert-manager-policy-attachment`, {
      role: certManagerRole,
      policyArn: certManagerPolicy.arn,
    }),
  ];

  const certManagerServiceAccount = new k8s.core.v1.ServiceAccount(
    `cert-manager-sa`,
    {
      metadata: {
        name: saName,
        namespace: 'kube-system',
        annotations: {
          'eks.amazonaws.com/role-arn': certManagerRole.arn,
        },
      },
    },
    { dependsOn: certManagerPolicies, deleteBeforeReplace: true },
  );

  const certManagerCrds = new k8s.yaml.ConfigFile(
    `cert-manager-crds`,
    {
      file: 'https://github.com/cert-manager/cert-manager/releases/download/v1.12.2/cert-manager.crds.yaml',
    },
    { dependsOn: certManagerServiceAccount },
  );

  return new k8s.helm.v3.Chart(
    `cert-manager`,
    {
      path: '../../charts/cert-manager',
      namespace: 'kube-system',
      skipAwait: true,
      values: {
        serviceAccount: {
          create: false,
          name: certManagerServiceAccount.metadata.name,
        },
        securityContext: {
          fsGroup: 1001,
        },
        // tolerations: [systemToleration],
        // nodeSelector: systemNodeLabels,
        startupapicheck: {
          enabled: false,
          // tolerations: [systemToleration],
          // nodeSelector: systemNodeLabels,
        },
        webhook: {
          // tolerations: [systemToleration],
          // nodeSelector: systemNodeLabels,
        },
        cainjector: {
          // tolerations: [systemToleration],
          // nodeSelector: systemNodeLabels,
        },
      },
    },
    { dependsOn: [certManagerCrds, ...certManagerPolicies, ...dependsOn] },
  );
}
