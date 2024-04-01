import type * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { clusterPetName } from '../lib/clusterIdentity';

export function getKubeConfig(cluster: aws.eks.Cluster): pulumi.Output<string> {
  return pulumi.jsonStringify({
    apiVersion: 'v1',
    kind: 'Config',
    clusters: [
      {
        cluster: {
          server: cluster.endpoint,
          'certificate-authority-data': cluster.certificateAuthority.data,
        },
        name: clusterPetName,
      },
    ],
    contexts: [
      {
        context: {
          cluster: clusterPetName,
          user: clusterPetName,
        },
        name: clusterPetName,
      },
    ],
    'current-context': clusterPetName,
    users: [
      {
        name: clusterPetName,
        user: {
          exec: {
            apiVersion: 'client.authentication.k8s.io/v1beta1',
            command: 'aws',
            args: ['eks', 'get-token', '--cluster-name', cluster.name],
          },
          env: [
            {
              name: 'KUBERNETES_EXEC_INFO',
              value: JSON.stringify({
                apiVersion: 'client.authentication.k8s.io/v1beta1',
              }),
            },
          ],
        },
      },
    ],
  });
}
