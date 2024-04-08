import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';
import * as pulumi from '@pulumi/pulumi';

import { vpcTags, privateSubnetTags, publicSubnetTags } from '../lib/vpcTags';

export default function main(): any {
  const config = new pulumi.Config();

  const vpcNetworkCidr = config.require('vpcNetworkCidr');
  const region = aws.config.requireRegion();

  const vpc = new awsx.ec2.Vpc('vpc', {
    enableDnsHostnames: true,
    cidrBlock: vpcNetworkCidr,
    subnetStrategy: 'Auto',
    subnetSpecs: [
      {
        // kubernetes.io/role/... tag required by https://docs.aws.amazon.com/eks/latest/userguide/network-load-balancing.html
        type: awsx.ec2.SubnetType.Public,
        tags: {
          ...publicSubnetTags,
          'kubernetes.io/role/elb': '1',
        },
      },
      {
        type: awsx.ec2.SubnetType.Private,
        tags: {
          ...privateSubnetTags,
          'kubernetes.io/role/internal-elb': '1',
        },
      },
    ],
    tags: vpcTags,
  });

  new aws.ec2.VpcEndpoint(`s3-gateway`, {
    vpcId: vpc.vpcId,
    serviceName: `com.amazonaws.${region}.s3`,
    routeTableIds: vpc.routeTables.apply((r) => r.map((rt) => rt.id)),
    tags: vpcTags,
  });

  const vpcAccessSg = new aws.ec2.SecurityGroup('endpoint-access', {
    vpcId: vpc.vpcId,
    tags: vpcTags,
  });

  new aws.vpc.SecurityGroupIngressRule('endpoint-access-ingress', {
    securityGroupId: vpcAccessSg.id,
    ipProtocol: '-1',
    cidrIpv4: vpcNetworkCidr,
    tags: vpcTags,
  });

  const interfaceEndpoints = ['ec2', 'ecr.dkr', 'ecr.api', 'logs', 'ssm', 'sqs', 'eks', 'sts', 'elasticfilesystem'];

  for (const endpoint of interfaceEndpoints) {
    const logicalName = endpoint.replace('.', '-');
    new aws.ec2.VpcEndpoint(logicalName, {
      vpcId: vpc.vpcId,
      serviceName: `com.amazonaws.${region}.${endpoint}`,
      vpcEndpointType: 'Interface',
      privateDnsEnabled: true,
      securityGroupIds: [vpcAccessSg.id],
      subnetIds: vpc.privateSubnetIds,
      tags: vpcTags,
    });
  }

  return {
    vpcId: vpc.vpcId,
    privateSubnetIds: vpc.privateSubnetIds,
    publicSubnetIds: vpc.publicSubnetIds,
  };
}
