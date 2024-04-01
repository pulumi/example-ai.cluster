import * as aws from '@pulumi/aws';
import * as k8s from '@pulumi/kubernetes';
import * as pulumi from '@pulumi/pulumi';
import * as tls from '@pulumi/tls';

import { clusterPetName, clusterTags, karpenterNodeSecurityGroupTags } from '../lib/clusterIdentity';
import { getKubeConfig } from './getKubeConfig';
import { gp3StorageClass } from './gp3StorageClass';
import { privateSubnetIds } from '../lib/vpcByReference';

const config = new pulumi.Config();
const adminRoleArn = config.require('adminRoleArn');
const additionalAdminArns = config.getObject<Record<string, string>>('additionalAdminArns') ?? {};

export default async function eksCluster(): Promise<{
  clusterName: pulumi.Output<string>;
  clusterVersion: pulumi.Output<string>;
  nodeSecurityGroupId: pulumi.Output<string>;
  oidcProviderArn: pulumi.Output<string>;
  oidcProviderUrl: pulumi.Output<string>;
  kubeconfig: pulumi.Output<any>;
}> {
  const { clusterKmsPolicy, kmsKey } = eksKmsKey();

  const clusterRole = new aws.iam.Role(`${clusterPetName}-cluster-role`, {
    assumeRolePolicy: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'sts:AssumeRole',
          Principal: {
            Service: ['eks.amazonaws.com'],
          },
          Effect: 'Allow',
        },
      ],
    },
    forceDetachPolicies: true,
  });

  const clusterRolePolicies = [
    new aws.iam.RolePolicyAttachment(`${clusterPetName}-cluster-policy`, {
      role: clusterRole,
      policyArn: 'arn:aws:iam::aws:policy/AmazonEKSClusterPolicy',
    }),
    new aws.iam.RolePolicyAttachment(`${clusterPetName}-cluster-policy-vpc`, {
      role: clusterRole,
      policyArn: 'arn:aws:iam::aws:policy/AmazonEKSVPCResourceController',
    }),
    new aws.iam.RolePolicyAttachment(`${clusterPetName}-cluster-kms-policy-attachment`, {
      role: clusterRole,
      policyArn: clusterKmsPolicy.arn,
    }),
  ];

  const cluster = new aws.eks.Cluster(
    clusterPetName,
    {
      roleArn: clusterRole.arn,
      version: '1.29',
      accessConfig: {
        authenticationMode: 'API',
      },
      vpcConfig: {
        subnetIds: privateSubnetIds,
      },
      encryptionConfig: {
        resources: ['secrets'],
        provider: { keyArn: kmsKey.arn },
      },
      tags: clusterTags,
      enabledClusterLogTypes: ['api', 'audit', 'authenticator', 'controllerManager', 'scheduler'],
    },
    { dependsOn: clusterRolePolicies },
  );

  const oidcProvider = eksOidcProvider(cluster);

  const nodeSecurityGroup = eksSecurityGroups(cluster);

  let kubeconfig = getKubeConfig(cluster);

  const adminPolicy = await eksAdminAccessPolicy(cluster);

  kubeconfig = pulumi.all([kubeconfig, adminPolicy.id]).apply(([kc, _]) => kc);

  const ssaProvider = new k8s.Provider(`${clusterPetName}-ssa`, {
    kubeconfig,
    suppressHelmHookWarnings: true,
    enableServerSideApply: true,
  });

  // Change the default storage class.
  gp3StorageClass(ssaProvider, cluster);

  return {
    clusterName: cluster.name,
    clusterVersion: cluster.version,
    oidcProviderUrl: oidcProvider.url,
    oidcProviderArn: oidcProvider.arn,
    nodeSecurityGroupId: nodeSecurityGroup.id,
    kubeconfig,
  };
}

function eksOidcProvider(cluster: aws.eks.Cluster): aws.iam.OpenIdConnectProvider {
  const oidcIssuerId = cluster.identities[0].oidcs[0].issuer;

  if (oidcIssuerId === undefined) {
    throw new Error('cluster.core.oidcProvider is undefined');
  }

  const cert = tls.getCertificateOutput({
    url: oidcIssuerId,
  });

  const oidcProvider = new aws.iam.OpenIdConnectProvider(`${clusterPetName}-oidc-provider`, {
    clientIdLists: ['sts.amazonaws.com'],
    url: oidcIssuerId,
    thumbprintLists: [cert.certificates[0].sha1Fingerprint],
    tags: {
      Name: pulumi.interpolate`${clusterPetName}-eks-irsa`,
    },
  });
  return oidcProvider;
}

async function eksAdminAccessPolicy(cluster: aws.eks.Cluster): Promise<aws.eks.AccessPolicyAssociation> {
  const callerIdentity = await aws.getCallerIdentity();
  const iamSessionContext = await aws.iam.getSessionContext({
    arn: callerIdentity.arn,
  });

  if (adminRoleArn !== iamSessionContext.issuerArn) {
    throw new Error(
      `The current user or role (${iamSessionContext.issuerArn}) is not the admin, assume the ${adminRoleArn} role to manage this cluster.`,
    );
  }

  function createAccessPolicy(name: string, roleArn: string): aws.eks.AccessPolicyAssociation {
    const awsAdminAccess = new aws.eks.AccessEntry(name, {
      clusterName: cluster.name,
      principalArn: roleArn,
    });

    const awsAdminAccessPolicy = new aws.eks.AccessPolicyAssociation(name, {
      clusterName: cluster.name,
      accessScope: {
        type: 'cluster',
      },
      policyArn: 'arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy',
      principalArn: awsAdminAccess.principalArn,
    });
    return awsAdminAccessPolicy;
  }

  const awsAdminAccessPolicy = createAccessPolicy(`${clusterPetName}-aws-admin`, adminRoleArn);

  for (const [name, roleArn] of Object.entries(additionalAdminArns)) {
    createAccessPolicy(`${clusterPetName}-${name}`, roleArn);
  }

  return awsAdminAccessPolicy;
}

function eksSecurityGroups(cluster: aws.eks.Cluster): aws.ec2.SecurityGroup {
  const nodeSecurityGroup = new aws.ec2.SecurityGroup(`${clusterPetName}-node-sg`, {
    vpcId: cluster.vpcConfig.vpcId,
    tags: karpenterNodeSecurityGroupTags,
  });

  // Cluster rules
  new aws.vpc.SecurityGroupIngressRule(`${clusterPetName}-node-cluster-api-server`, {
    description: 'Allow pods to communicate with the cluster API Server',
    securityGroupId: cluster.vpcConfig.clusterSecurityGroupId,
    referencedSecurityGroupId: nodeSecurityGroup.id,
    fromPort: 443,
    toPort: 443,
    ipProtocol: 'tcp',
  });

  // Node rules
  new aws.vpc.SecurityGroupIngressRule(`${clusterPetName}-cluster-node-https`, {
    description: 'Allow the control plane to communicate with worker nodes over HTTPS',
    securityGroupId: nodeSecurityGroup.id,
    referencedSecurityGroupId: cluster.vpcConfig.clusterSecurityGroupId,
    fromPort: 443,
    toPort: 443,
    ipProtocol: 'tcp',
  });

  new aws.vpc.SecurityGroupIngressRule(`${clusterPetName}-cluster-node-kubelets`, {
    description: 'Allow the control plane to communicate with worker nodes kubelets',
    securityGroupId: nodeSecurityGroup.id,
    referencedSecurityGroupId: cluster.vpcConfig.clusterSecurityGroupId,
    fromPort: 10250,
    toPort: 10250,
    ipProtocol: 'tcp',
  });

  new aws.vpc.SecurityGroupIngressRule(`${clusterPetName}-node-node-dns-tcp`, {
    description: 'Allow worker nodes to communicate with each other for DNS (tcp)',
    securityGroupId: nodeSecurityGroup.id,
    referencedSecurityGroupId: nodeSecurityGroup.id,
    fromPort: 53,
    toPort: 53,
    ipProtocol: 'tcp',
  });

  new aws.vpc.SecurityGroupIngressRule(`${clusterPetName}-node-node-dns-udp`, {
    description: 'Allow worker nodes to communicate with each other for DNS (udp)',
    securityGroupId: nodeSecurityGroup.id,
    referencedSecurityGroupId: nodeSecurityGroup.id,
    fromPort: 53,
    toPort: 53,
    ipProtocol: 'udp',
  });

  new aws.vpc.SecurityGroupIngressRule(`${clusterPetName}-node-node-all`, {
    description: 'Allow worker nodes to communicate with each other on all ports by default',
    securityGroupId: nodeSecurityGroup.id,
    referencedSecurityGroupId: nodeSecurityGroup.id,
    ipProtocol: '-1',
  });

  new aws.vpc.SecurityGroupEgressRule(`${clusterPetName}-node-internet-ipv4`, {
    description: 'Allow worker nodes to connect to the internet',
    securityGroupId: nodeSecurityGroup.id,
    cidrIpv4: '0.0.0.0/0',
    ipProtocol: '-1',
  });

  new aws.vpc.SecurityGroupEgressRule(`${clusterPetName}-node-internet-ipv6`, {
    description: 'Allow worker nodes to connect to the internet',
    securityGroupId: nodeSecurityGroup.id,
    cidrIpv6: '::/0',
    ipProtocol: '-1',
  });
  return nodeSecurityGroup;
}

function eksKmsKey(): { clusterKmsPolicy: aws.iam.Policy; kmsKey: aws.kms.Key } {
  const kmsKey = new aws.kms.Key(`${clusterPetName}`, {
    enableKeyRotation: true,
    description: `KMS key for EKS cluster '${clusterPetName}' secrets`,
  });

  const keyPolicyDocument = aws.iam.getPolicyDocumentOutput({
    statements: [
      {
        sid: 'AllowAccessToKmsKey',
        actions: ['kms:Decrypt', 'kms:Encrypt', 'kms:ListGrants', 'kms:DescribeKey'],
        effect: 'Allow',
        resources: [kmsKey.arn],
      },
    ],
  });

  const clusterKmsPolicy = new aws.iam.Policy(`${clusterPetName}-cluster-kms-policy`, {
    description: `KMS policy for EKS cluster '${clusterPetName}'`,
    policy: keyPolicyDocument.json,
  });

  return { clusterKmsPolicy, kmsKey };
}
