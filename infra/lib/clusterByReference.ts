import * as pulumi from '@pulumi/pulumi';

const stackName = pulumi.getStack();
const org = pulumi.getOrganization();

const clusterStack = new pulumi.StackReference('cluster', {
  name: `${org}/pulumi-ai-eks-cluster/${stackName}`,
});

export const clusterName = clusterStack.requireOutput('clusterName');
export const clusterVersion = clusterStack.requireOutput('clusterVersion');
export const oidcProviderUrl = clusterStack.requireOutput('oidcProviderUrl');
export const oidcProviderArn = clusterStack.requireOutput('oidcProviderArn');
export const nodeSecurityGroupId = clusterStack.requireOutput('nodeSecurityGroupId');
export const clusterSecurityGroupId = clusterStack.requireOutput('clusterSecurityGroupId');
