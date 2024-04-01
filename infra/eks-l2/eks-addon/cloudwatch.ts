import * as aws from '@pulumi/aws';
import * as k8s from '@pulumi/kubernetes';

import { clusterName, clusterVersion } from '../../lib/clusterByReference';
import { clusterPetName } from '../../lib/clusterIdentity';
import { IamServiceAccountRole } from '../../lib/eks/IamServiceAccountRole';

export function cloudwatchObservabilityAddon({ dependsOn = [] }: { dependsOn?: aws.eks.Addon[] }): aws.eks.Addon {
  const role = IamServiceAccountRole(`${clusterPetName}-cloudwatch-observability`, {
    namespaceName: 'amazon-cloudwatch',
    serviceAccountName: 'cloudwatch-agent',
  });

  new aws.iam.RolePolicyAttachment(`${clusterPetName}-cloudwatch-observability-agent`, {
    policyArn: 'arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy',
    role,
  });
  new aws.iam.RolePolicyAttachment(`${clusterPetName}-cloudwatch-observability-xray`, {
    policyArn: 'arn:aws:iam::aws:policy/AWSXrayWriteOnlyAccess',
    role,
  });

  const addonVersion = aws.eks.getAddonVersionOutput({
    addonName: 'amazon-cloudwatch-observability',
    kubernetesVersion: clusterVersion,
    mostRecent: true,
  });

  const addon = new aws.eks.Addon(
    `${clusterPetName}-cloudwatch-observability`,
    {
      clusterName,
      addonName: addonVersion.addonName,
      addonVersion: addonVersion.version,
      serviceAccountRoleArn: role.arn,
      preserve: false,
    },
    { dependsOn },
  );

  // TODO:
  // https://github.com/aws/amazon-cloudwatch-agent/issues/1085
  // https://github.com/aws/amazon-cloudwatch-agent-operator/issues/119
  new k8s.apiextensions.CustomResourcePatch(
    'cloudwatch-agent-irsa',
    {
      apiVersion: 'cloudwatch.aws.amazon.com/v1alpha1',
      kind: 'AmazonCloudWatchAgent',
      metadata: {
        name: 'cloudwatch-agent',
        namespace: 'amazon-cloudwatch',
        annotations: {
          'pulumi.com/patchForce': 'true',
        },
      },
      spec: {
        // Must specify all existing env vars:
        env: [
          {
            name: 'RUN_WITH_IRSA',
            value: 'true',
          },
          {
            name: 'K8S_NODE_NAME',
            valueFrom: {
              fieldRef: {
                fieldPath: 'spec.nodeName',
              },
            },
          },
          {
            name: 'HOST_IP',
            valueFrom: {
              fieldRef: {
                fieldPath: 'status.hostIP',
              },
            },
          },
          {
            name: 'HOST_NAME',
            valueFrom: {
              fieldRef: {
                fieldPath: 'spec.nodeName',
              },
            },
          },
          {
            name: 'K8S_NAMESPACE',
            valueFrom: {
              fieldRef: {
                fieldPath: 'metadata.namespace',
              },
            },
          },
        ],
      },
    },
    { dependsOn: [addon], retainOnDelete: true, deletedWith: addon },
  );

  return addon;
}
