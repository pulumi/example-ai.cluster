import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { clusterName, clusterVersion } from '../../lib/clusterByReference';
import { clusterPetName } from '../../lib/clusterIdentity';

export function podIdentityAddon({ dependsOn }: { dependsOn?: pulumi.Resource[] } = {}): aws.eks.Addon {
  const addonVersion = aws.eks.getAddonVersionOutput({
    addonName: 'eks-pod-identity-agent',
    kubernetesVersion: clusterVersion,
    mostRecent: true,
  });

  return new aws.eks.Addon(
    `${clusterPetName}-pod-identity`,
    {
      clusterName,
      addonName: addonVersion.addonName,
      addonVersion: addonVersion.version,
      configurationValues: pulumi.jsonStringify({
        tolerations: [
          // Allow pods to be scheduled on nodes early, for CNI:
          {
            operator: 'Exists',
            effect: 'NoExecute',
          },
          {
            operator: 'Exists',
            effect: 'NoSchedule',
          },
        ],
      }),
      preserve: false,
    },
    {
      dependsOn,
    },
  );
}
