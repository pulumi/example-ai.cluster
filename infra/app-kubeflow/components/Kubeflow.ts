import * as k8s from '@pulumi/kubernetes';
import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import { clusterResources, namespacedResources, patchForce, skipAwait } from './skipAwait';
import { clusterSecurityGroupId, nodeSecurityGroupId } from '../../lib/clusterByReference';

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface KubeflowArgs {}

// This is only a component to provide visual separation of the resources in the deployment, as
// Kubeflow does not support being deployed multiple times in the same cluster.
export class Kubeflow extends pulumi.ComponentResource {
  constructor(name: string, args: KubeflowArgs = {}, opts?: pulumi.ComponentResourceOptions) {
    super('component:index:Kubeflow', name, args, opts);

    opts = { parent: this, ...opts };

    let dependsOn = pulumi.output(opts.dependsOn).apply((deps): pulumi.Resource[] => {
      if (deps === undefined) {
        return [];
      }

      if (Array.isArray(deps)) {
        return deps;
      }

      return [deps];
    });

    const crds = new k8s.kustomize.Directory(
      `${name}-crds`,
      {
        directory: './kubeflow', // relative to Pulumi project root
        transformations: [clusterResources, skipAwait, patchForce],
      },
      { ...opts, retainOnDelete: true },
    );

    dependsOn = pulumi.all([dependsOn, crds, crds.resources]).apply(([dependsOn, crds, crdResources]) => {
      return [...dependsOn, crds, ...Object.values(crdResources)];
    });

    const clusterSgId = clusterSecurityGroupId;

    new aws.vpc.SecurityGroupIngressRule(
      `${name}-admission-webhook-service`,
      {
        securityGroupId: nodeSecurityGroupId,
        description: 'Kubeflow mutating admission webhook service',
        fromPort: 4443,
        toPort: 4443,
        ipProtocol: 'tcp',
        referencedSecurityGroupId: clusterSgId,
      },
      opts,
    );

    new aws.vpc.SecurityGroupIngressRule(
      `${name}-katib-webhook-service`,
      {
        securityGroupId: nodeSecurityGroupId,
        description: 'Katib mutating admission controller webhook',
        fromPort: 8443,
        toPort: 8443,
        ipProtocol: 'tcp',
        referencedSecurityGroupId: clusterSgId,
      },
      opts,
    );

    const kubeflowNs = new k8s.core.v1.Namespace(
      `${name}`,
      {
        metadata: {
          name: 'kubeflow',
          labels: {
            'control-plane': 'kubeflow',
            'istio-injection': 'enabled',
            'istio.io/dataplane-mode': 'ambient',
          },
        },
      },
      opts,
    );

    dependsOn = pulumi.all([dependsOn, kubeflowNs]).apply(([dependsOn]) => [...dependsOn, kubeflowNs]);

    new k8s.kustomize.Directory(
      `${name}`,
      {
        directory: './kubeflow', // relative to Pulumi project root
        transformations: [namespacedResources, skipAwait, patchForce],
      },
      { ...opts, dependsOn },
    );
  }
}
