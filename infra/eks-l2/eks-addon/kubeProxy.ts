import * as aws from '@pulumi/aws';
import type * as pulumi from '@pulumi/pulumi';

import { clusterName, clusterVersion } from '../../lib/clusterByReference';
import { clusterPetName } from '../../lib/clusterIdentity';

export function kubeProxyAddon(dependsOn: pulumi.Resource[] = []): aws.eks.Addon {
  const addonVersion = aws.eks.getAddonVersionOutput({
    addonName: 'kube-proxy',
    kubernetesVersion: clusterVersion,
    mostRecent: true,
  });

  return new aws.eks.Addon(
    `${clusterPetName}-kube-proxy`,
    {
      clusterName,
      addonName: addonVersion.addonName,
      addonVersion: addonVersion.version,
      resolveConflictsOnCreate: 'OVERWRITE',
      resolveConflictsOnUpdate: 'PRESERVE',
      preserve: false,
    },
    { dependsOn },
  );
}
