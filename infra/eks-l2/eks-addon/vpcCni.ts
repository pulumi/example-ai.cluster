import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { clusterName, clusterVersion } from '../../lib/clusterByReference';
import { clusterPetName } from '../../lib/clusterIdentity';
import { PodIdentityRole } from '../../lib/eks/PodIdentityRole';

export function vpcCniAddon({ dependsOn = [] }: { dependsOn?: pulumi.Resource[] } = {}): aws.eks.Addon {
  const vpcCsiRole = PodIdentityRole(`${clusterPetName}-vpc-cni-role`, {
    clusterName,
    namespaceName: 'kube-system',
    serviceAccountName: 'aws-node',
  });

  const vpcCsiRolePolicies = [
    new aws.iam.RolePolicyAttachment(`${clusterPetName}-vpc-cni-policy`, {
      role: vpcCsiRole,
      policyArn: 'arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy',
    }),
  ];

  const addonVersion = aws.eks.getAddonVersionOutput({
    addonName: 'vpc-cni',
    kubernetesVersion: clusterVersion,
    mostRecent: true,
  });

  return new aws.eks.Addon(
    `${clusterPetName}-vpc-cni`,
    {
      clusterName,
      addonName: addonVersion.addonName,
      addonVersion: addonVersion.version,
      resolveConflictsOnCreate: 'OVERWRITE',
      resolveConflictsOnUpdate: 'PRESERVE',
      serviceAccountRoleArn: vpcCsiRole.arn,
      preserve: false,
      configurationValues: pulumi.jsonStringify({
        tolerations: [
          {
            operator: 'Exists',
          },
        ],
      }),
    },
    { dependsOn: [...vpcCsiRolePolicies, ...dependsOn] },
  );
}
