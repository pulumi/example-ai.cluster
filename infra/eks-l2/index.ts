import * as k8s from '@pulumi/kubernetes';
import * as aws from '@pulumi/aws';

import { awsLoadBalancerControllerChart } from './charts/awsLoadBalancerController';
import { certManagerChart } from './charts/certManager';
import { cloudwatchObservabilityAddon } from './eks-addon/cloudwatch';
import { coreDnsAddon } from './eks-addon/coreDns';
import { kubeProxyAddon } from './eks-addon/kubeProxy';
import { podIdentityAddon } from './eks-addon/podIdentity';
import { vpcCniAddon } from './eks-addon/vpcCni';
import { fargateLogging } from './fargateLogging';
import { ebsCsiAddon } from './eks-addon/ebsCsi';
import { externalDnsChart } from './charts/externalDns';
import { clusterPetName } from '../lib/clusterIdentity';
import { efsCsiAddon } from './eks-addon/efsCsi';

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

efsCsiAddon({ dependsOn: [podIdentity] });

const certManager = certManagerChart({ dependsOn: [podIdentity] });

const hostedZone = aws.route53.getZoneOutput({
  name: 'pulumi-demos.net',
});

const ownedFqdn = `${clusterPetName}.pulumi-demos.net`;
const subdomainZone = new aws.route53.Zone('subdomain', {
  name: ownedFqdn,
});

new aws.route53.Record('subdomain-ns-delegation', {
  name: subdomainZone.name,
  zoneId: hostedZone.zoneId,
  type: 'NS',
  ttl: 60,
  records: subdomainZone.nameServers,
});

const cert = new aws.acm.Certificate('subdomain', {
  domainName: ownedFqdn,
  subjectAlternativeNames: [`*.${ownedFqdn}`],
  validationMethod: 'DNS',
});

const validationRecordFqdns = cert.domainValidationOptions.apply((opts) => {
  // The same name can appear multiple times in the outputs of the cert resource.
  const names = new Set<string>();

  return opts.flatMap((opt, idx) => {
    if (names.has(opt.resourceRecordName)) {
      return [];
    }
    names.add(opt.resourceRecordName);
    const dnsValidation = new aws.route53.Record(`validation-${opt.domainName}`, {
      name: opt.resourceRecordName,
      zoneId: subdomainZone.zoneId,
      type: opt.resourceRecordType,
      records: [opt.resourceRecordValue],
      ttl: 60,
    });

    return [dnsValidation.fqdn];
  });
});

new aws.acm.CertificateValidation('subdomain', {
  certificateArn: cert.arn,
  validationRecordFqdns,
});

externalDnsChart({ zone: subdomainZone, dependsOn: [podIdentity] });

// ingressNginxChart({ cluster, provider, nodeSecurityGroup, dependsOn: [ebsCsi, vpcCni] });

// externalDnsChart({ cluster, provider, oidcProvider, dependsOn: [vpcCni] });

awsLoadBalancerControllerChart({ dependsOn: [podIdentity, vpcCni, certManager] });
