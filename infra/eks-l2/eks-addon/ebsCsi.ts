import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { clusterPetName, clusterTags } from '../../lib/clusterIdentity';
import { PodIdentityRole } from '../../lib/eks/PodIdentityRole';
import { clusterName, clusterVersion } from '../../lib/clusterByReference';

export function ebsCsiAddon({ dependsOn = [] }: { dependsOn?: pulumi.Resource[] } = {}): aws.eks.Addon {
  const ebsCsiRole = PodIdentityRole(`${clusterPetName}-ebs-csi-role`, {
    clusterName,
    namespaceName: 'kube-system',
    serviceAccountName: 'ebs-csi-controller-sa',
  });

  const ebsCsiRolePolicies = [
    new aws.iam.RolePolicyAttachment(`${clusterPetName}-ebs-csi-policy`, {
      role: ebsCsiRole,
      policyArn: 'arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy',
    }),
  ];

  const addonVersion = aws.eks.getAddonVersionOutput({
    addonName: 'aws-ebs-csi-driver',
    kubernetesVersion: clusterVersion,
    mostRecent: true,
  });

  const ebsCsiAddon = new aws.eks.Addon(
    `${clusterPetName}-ebs-csi`,
    {
      clusterName,
      addonName: addonVersion.addonName,
      addonVersion: addonVersion.version,
      serviceAccountRoleArn: ebsCsiRole.arn,
      resolveConflictsOnCreate: 'OVERWRITE',
      resolveConflictsOnUpdate: 'PRESERVE',
      configurationValues: pulumi.jsonStringify({
        controller: {
          // tolerations: [systemToleration],
          // nodeSelector: systemNodeLabels,
          extraVolumeTags: clusterTags,
        },
      }),
      preserve: false,
    },
    { dependsOn: [...ebsCsiRolePolicies, ...dependsOn] },
  );
  return ebsCsiAddon;
}
