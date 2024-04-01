import type * as aws from '@pulumi/aws';
import * as k8s from '@pulumi/kubernetes';

export function gp3StorageClass(provider: k8s.Provider, cluster: aws.eks.Cluster): void {
  new k8s.storage.v1.StorageClass(
    'gp2-storage-class',
    {
      metadata: {
        name: 'gp2',
        annotations: {
          'pulumi.com/patchForce': 'true',
          'storageclass.kubernetes.io/is-default-class': 'false',
        },
      },
      volumeBindingMode: 'WaitForFirstConsumer',
      provisioner: 'kubernetes.io/aws-ebs',
      reclaimPolicy: 'Delete',
    },
    { provider, deletedWith: cluster },
  );

  new k8s.storage.v1.StorageClass(
    'gp3-storage-class',
    {
      metadata: {
        name: 'gp3',
        annotations: {
          'storageclass.kubernetes.io/is-default-class': 'true',
        },
      },
      provisioner: 'ebs.csi.aws.com',
      volumeBindingMode: 'WaitForFirstConsumer',
      reclaimPolicy: 'Delete',
      parameters: {
        'csi.storage.k8s.io/fstype': 'ext4',
        type: 'gp3',
      },
    },
    { provider, deletedWith: cluster, deleteBeforeReplace: true },
  );
}
