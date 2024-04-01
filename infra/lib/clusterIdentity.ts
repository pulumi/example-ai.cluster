import * as pulumi from '@pulumi/pulumi';

export const config = new pulumi.Config();

// This ID is used extensively in AWS resource names to provide context in the console and
// discoverability in Resource Search.
export const clusterPetName = config.require('clusterPetName');

export const karpenterNodeSecurityGroupTags = {
  'karpenter.sh/discovery': `${clusterPetName}-default`,
};

export const clusterTags = config.requireObject<Record<string, string>>('clusterTags');
