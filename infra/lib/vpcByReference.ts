import * as pulumi from '@pulumi/pulumi';

const stackName = pulumi.getStack();
const org = pulumi.getOrganization();

// e.g.: staging-gold-kiwi -> staging
const vpcStackName = stackName.split('-')[0];

const vpcStack = new pulumi.StackReference('vpc', {
  name: `${org}/pulumi-ai-aws-vpc/${vpcStackName}`,
});

export const vpcId = vpcStack.requireOutput('vpcId');
export const privateSubnetIds = vpcStack.requireOutput('privateSubnetIds');
export const publicSubnetIds = vpcStack.requireOutput('publicSubnetIds');
