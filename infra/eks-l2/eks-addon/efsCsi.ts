import * as aws from '@pulumi/aws';
import * as k8s from '@pulumi/kubernetes';
import * as pulumi from '@pulumi/pulumi';
import { clusterName, clusterVersion, nodeSecurityGroupId } from '../../lib/clusterByReference';
import { clusterPetName, clusterTags } from '../../lib/clusterIdentity';

import { IamServiceAccountRole } from '../../lib/eks/IamServiceAccountRole';
import { privateSubnetIds, vpcId } from '../../lib/vpcByReference';

export function efsCsiAddon({ dependsOn = [] }: { dependsOn?: pulumi.Resource[] } = {}): aws.eks.Addon {
  const efsCsiRole = IamServiceAccountRole(`${clusterPetName}-efs-csi-role`, {
    namespaceName: 'kube-system',
    // Uses a wildcard, per:
    // https://docs.aws.amazon.com/eks/latest/userguide/efs-csi.html#efs-create-iam-resources
    serviceAccountName: 'efs-csi-*',
    serviceAccountNameTest: 'StringLike',
  });

  const efsCsiRolePolicies = [
    new aws.iam.RolePolicyAttachment(`${clusterPetName}-efs-csi-policy`, {
      role: efsCsiRole,
      policyArn: aws.iam.ManagedPolicy.AmazonEFSCSIDriverPolicy,
    }),

    new aws.iam.RolePolicy(`${clusterPetName}-efs-csi-policy`, {
      role: efsCsiRole,
      policy: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: ['elasticfilesystem:DescribeAccessPoints', 'elasticfilesystem:DescribeFileSystems'],
            Resource: '*',
          },
          {
            Effect: 'Allow',
            Action: ['elasticfilesystem:CreateAccessPoint'],
            Resource: '*',
            Condition: {
              StringLike: {
                'aws:RequestTag/efs.csi.aws.com/cluster': 'true',
              },
            },
          },
          {
            Effect: 'Allow',
            Action: 'elasticfilesystem:DeleteAccessPoint',
            Resource: '*',
            Condition: {
              StringEquals: {
                'aws:ResourceTag/efs.csi.aws.com/cluster': 'true',
              },
            },
          },
        ],
      },
    }),
  ];

  const kmsKey = new aws.kms.Key(clusterPetName, {
    enableKeyRotation: true,
    tags: clusterTags,
    description: 'KMS key for language model caching',
  });

  const efsFs = new aws.efs.FileSystem(clusterPetName, {
    encrypted: true,
    kmsKeyId: kmsKey.arn,
    performanceMode: 'generalPurpose',
    throughputMode: 'elastic',
  });

  const efsMountSg = new aws.ec2.SecurityGroup(`${clusterPetName}-efs-mount-sg`, {
    vpcId,
    tags: clusterTags,
  });

  new aws.vpc.SecurityGroupIngressRule(`${clusterPetName}-efs-from-node`, {
    securityGroupId: efsMountSg.id,
    ipProtocol: 'tcp',
    fromPort: 2049,
    toPort: 2049,
    description: 'Allow EFS mount targets to accept traffic from EKS nodes',
    referencedSecurityGroupId: nodeSecurityGroupId,
  });

  new aws.vpc.SecurityGroupEgressRule(`${clusterPetName}-node-to-efs`, {
    securityGroupId: efsMountSg.id,
    ipProtocol: 'tcp',
    fromPort: 2049,
    toPort: 2049,
    description: 'Allow EKS nodes to connect to EFS mount targets',
    referencedSecurityGroupId: nodeSecurityGroupId,
  });

  privateSubnetIds.apply((ids) => {
    for (const subnetId of ids) {
      new aws.efs.MountTarget(`clusterPetName-${subnetId}`, {
        fileSystemId: efsFs.id,
        subnetId,
        securityGroups: [efsMountSg.id],
      });
    }
  });

  new k8s.storage.v1.StorageClass('efs-csi-sc', {
    metadata: {
      name: 'efs-sc',
    },
    provisioner: 'efs.csi.aws.com',
    parameters: {
      provisioningMode: 'efs-ap',
      fileSystemId: efsFs.id,
      directoryPerms: '700',
      basePath: `/${clusterPetName}`,
      // eslint-disable-next-line no-template-curly-in-string
      subPathPattern: '${.PVC.namespace}/${.PVC.name}',
      ensureUniqueDirectory: 'true',
    },
  });

  const addonVersion = aws.eks.getAddonVersionOutput({
    addonName: 'aws-efs-csi-driver',
    kubernetesVersion: clusterVersion,
    mostRecent: true,
  });

  const efsCsiAddon = new aws.eks.Addon(
    `${clusterPetName}-efs-csi`,
    {
      clusterName,
      addonName: addonVersion.addonName,
      addonVersion: addonVersion.version,
      serviceAccountRoleArn: efsCsiRole.arn,
      resolveConflictsOnCreate: 'OVERWRITE',
      resolveConflictsOnUpdate: 'PRESERVE',
      configurationValues: pulumi.jsonStringify({}),
      preserve: false,
    },
    { dependsOn: [...efsCsiRolePolicies, ...dependsOn] },
  );
  return efsCsiAddon;
}
