import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

import { clusterName, clusterVersion } from '../../lib/clusterByReference';
import { clusterPetName } from '../../lib/clusterIdentity';

export function coreDnsAddon({ dependsOn = [] }: { dependsOn?: pulumi.Resource[] } = {}): aws.eks.Addon {
  const addonVersion = aws.eks.getAddonVersionOutput({
    addonName: 'coredns',
    kubernetesVersion: clusterVersion,
    mostRecent: true,
  });

  return new aws.eks.Addon(
    `${clusterPetName}-coredns`,
    {
      clusterName,
      addonName: addonVersion.addonName,
      addonVersion: addonVersion.version,
      // Use Pulumi as the source of truth:
      resolveConflictsOnCreate: 'OVERWRITE',
      resolveConflictsOnUpdate: 'OVERWRITE',
      configurationValues: pulumi.jsonStringify({
        // tolerations: [systemToleration],
        // nodeSelector: systemNodeLabels,
        affinity: {
          nodeAffinity: {
            // This key is a default value for the addon.
            requiredDuringSchedulingIgnoredDuringExecution: {
              nodeSelectorTerms: [
                {
                  matchExpressions: [
                    {
                      key: 'kubernetes.io/os',
                      operator: 'In',
                      values: ['linux'],
                    },
                    {
                      key: 'kubernetes.io/arch',
                      operator: 'In',
                      values: ['amd64', 'arm64'],
                    },
                  ],
                },
              ],
            },
          },
          podAntiAffinity: {
            // This is modified to "required" to provide redundancy in the event of node disruption:
            requiredDuringSchedulingIgnoredDuringExecution: [
              {
                labelSelector: {
                  matchExpressions: [
                    {
                      key: 'k8s-app',
                      operator: 'In',
                      values: ['kube-dns'],
                    },
                  ],
                },
                topologyKey: 'kubernetes.io/hostname',
              },
            ],
          },
        },
      }),
      preserve: false,
    },
    { dependsOn },
  );
}
