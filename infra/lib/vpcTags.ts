import * as pulumi from '@pulumi/pulumi';

const config = new pulumi.Config();
const vpcTags = config.requireObject<Record<string, string>>('vpcTags');

if (typeof vpcTags !== 'object') {
  throw new Error('vpcTags must be an object');
}

export { vpcTags };

export const publicSubnetTags = {
  ...vpcTags,
  'subnet-type': 'public',
};

export const privateSubnetTags = {
  ...vpcTags,
  'subnet-type': 'private',
};
