import * as k8s from '@pulumi/kubernetes';

import { awsLoadBalancerControllerChart } from './charts/awsLoadBalancerController';
import { certManagerChart } from './charts/certManager';
import { cloudwatchObservabilityAddon } from './eks-addon/cloudwatch';
import { coreDnsAddon } from './eks-addon/coreDns';
import { kubeProxyAddon } from './eks-addon/kubeProxy';
import { podIdentityAddon } from './eks-addon/podIdentity';
import { vpcCniAddon } from './eks-addon/vpcCni';
import { fargateLogging } from './fargateLogging';
import { ebsCsiAddon } from './eks-addon/ebsCsi';

fargateLogging();

kubeProxyAddon();

new k8s.yaml.ConfigFile('metrics-server', {
  file: './manifests/metricsServer.yaml',
});

const coreDns = coreDnsAddon();

const podIdentity = podIdentityAddon();

const vpcCni = vpcCniAddon({ dependsOn: [coreDns, podIdentity] });

cloudwatchObservabilityAddon({ dependsOn: [podIdentity, vpcCni] });

ebsCsiAddon({ dependsOn: [podIdentity] });

const certManager = certManagerChart({ dependsOn: [podIdentity] });

// ingressNginxChart({ cluster, provider, nodeSecurityGroup, dependsOn: [ebsCsi, vpcCni] });

// externalDnsChart({ cluster, provider, oidcProvider, dependsOn: [vpcCni] });

awsLoadBalancerControllerChart({ dependsOn: [podIdentity, vpcCni, certManager] });
