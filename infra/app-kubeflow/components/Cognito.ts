import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

/*
const authStack = new pulumi.StackReference(`pulumi/corp.pulumi.com-auth/corp`);

const corpAuthLambdaArn = authStack.getOutput('lambdaArn');
const corpAuthCertificateArn = authStack.getOutput('certificateArn');
// We'll create our Route 53 record in this hosted zone
const hostedZoneId = authStack.getOutput('hostedZoneId');

 */

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface CognitoArgs {
  googleClientId: pulumi.Input<string>;
  googleClientSecret: pulumi.Input<string>;

  // The subdomain on which to host the Kubeflow app, i.e.: 'platform'.
  platformSubdomain: pulumi.Input<string>;
  // The parent zone ID in which to create the Route53 records, i.e.: given the ID for
  // "example.com", produce a fqdn of "platform.example.com".
  parentZoneId: pulumi.Input<string>;
}

const awsEastProvider = new aws.Provider(`cognito-aws-us-east-1`, {
  region: 'us-east-1',
});

export class Cognito extends pulumi.ComponentResource {
  constructor(name: string, args: CognitoArgs, opts?: pulumi.ComponentResourceOptions) {
    super('component:index:Cognito', name, args, opts);

    opts = { parent: this, ...opts };

    const hostedZone = pulumi.output(args.parentZoneId).apply((hzid) =>
      aws.route53.getZoneOutput(
        {
          zoneId: hzid,
        },
        { ...opts, provider: awsEastProvider, async: true },
      ),
    );

    // Fqdn = fully qualified domain name
    const platformFqdn = pulumi.interpolate`${args.platformSubdomain}.${hostedZone.name}`;
    const platformWildcardSubdomainFqdn = pulumi.interpolate`*.${platformFqdn}`;
    const authSubdomain = 'auth';
    const kubeflowSubdomain = 'app';
    const authFqdn = pulumi.interpolate`${authSubdomain}.${platformFqdn}`;
    const kubeflowFqdn = pulumi.interpolate`${kubeflowSubdomain}.${platformFqdn}`;

    pulumi
      .output({
        platformFqdn,
        platformWildcardSubdomainFqdn,
        authFqdn,
      })
      .apply((fqdns) => {
        console.log(`Cognito FQDNs`, fqdns);
      });

    // We'll use a cognito pool with Google as the identity provider
    const userPool = new aws.cognito.UserPool(
      name,
      {
        name,
        autoVerifiedAttributes: ['email'],
      },
      opts,
    );

    new aws.cognito.IdentityProvider(
      name,
      {
        userPoolId: userPool.id,
        providerName: 'Google',
        providerType: 'Google',
        providerDetails: {
          client_id: args.googleClientId,
          client_secret: args.googleClientSecret,
          oidc_issuer: 'https://accounts.google.com',
          authorize_scopes: 'email profile openid',
          authorize_url: 'https://accounts.google.com/o/oauth2/v2/auth',
          token_url: 'https://www.googleapis.com/oauth2/v4/token',
          token_request_method: 'POST',
          attributes_url: 'https://people.googleapis.com/v1/people/me?personFields=',
          attributes_url_add_attributes: 'true',
        },
        attributeMapping: {
          email: 'email',
          username: 'sub',
        },
      },
      opts,
    );

    new aws.cognito.UserPoolClient(
      name,
      {
        name,
        userPoolId: userPool.id,
        generateSecret: true,
        supportedIdentityProviders: ['Google'],
        allowedOauthFlows: ['code'],
        allowedOauthFlowsUserPoolClient: true,
        allowedOauthScopes: ['email', 'openid', 'profile'],
        callbackUrls: [pulumi.interpolate`https://${kubeflowFqdn}/oauth2/idpresponse`],
        logoutUrls: [pulumi.interpolate`https://${kubeflowFqdn}`],
      },
      opts,
    );

    // This record will be overwritten later.
    const tempARecord = new aws.route53.Record(
      `${name}-temp-platform-fqdn`,
      {
        allowOverwrite: true,
        name: platformFqdn,
        zoneId: args.parentZoneId,
        type: 'A',
        records: ['203.0.113.1'], // reserved test IP address, will be replaced by ALB.
        ttl: 300,
      },
      { ...opts, provider: awsEastProvider, ignoreChanges: ['*'] },
    );

    const cert = new aws.acm.Certificate(
      name,
      {
        domainName: platformWildcardSubdomainFqdn,
        validationMethod: 'DNS',
      },
      { ...opts, provider: awsEastProvider },
    );

    const certValidation = new aws.route53.Record(
      `${name}-cert-validation`,
      {
        name: cert.domainValidationOptions[0].resourceRecordName,
        zoneId: hostedZone.id,
        type: cert.domainValidationOptions[0].resourceRecordType,
        records: [cert.domainValidationOptions[0].resourceRecordValue],
        ttl: 60,
      },
      { ...opts, provider: awsEastProvider },
    );

    new aws.acm.CertificateValidation(
      'cert',
      {
        certificateArn: cert.arn,
        validationRecordFqdns: [certValidation.fqdn],
      },
      { ...opts, provider: awsEastProvider },
    );

    const userPoolDomain = new aws.cognito.UserPoolDomain(
      name,
      {
        domain: authFqdn,
        certificateArn: cert.arn,
        userPoolId: userPool.id,
      },
      {
        ...opts,
        dependsOn: [tempARecord],
      },
    );

    new aws.route53.Record(`${name}-auth`, {
      allowOverwrite: true,
      name: userPoolDomain.domain,
      type: 'A',
      zoneId: hostedZone.id,
      aliases: [
        {
          evaluateTargetHealth: false,
          name: userPoolDomain.cloudfrontDistributionArn,
          zoneId: userPoolDomain.cloudfrontDistributionZoneId,
        },
      ],
    });
  }
}
