import * as aws from '@pulumi/aws';
import * as k8s from '@pulumi/kubernetes';

export function fargateLogging(): void {
  const ns = new k8s.core.v1.Namespace('aws-observability', {
    metadata: {
      name: 'aws-observability',
      labels: {
        'aws-observability': 'enabled',
      },
    },
  });

  new k8s.core.v1.ConfigMap('aws-logging', {
    metadata: {
      name: 'aws-logging',
      namespace: ns.metadata.name,
    },
    data: {
      flb_log_cw: 'true',
      'filters.conf': `\
[FILTER]
    Name parser
    Match *
    Key_name log
    Parser crio
[FILTER]
    Name kubernetes
    Match kube.*
    Merge_Log On
    Keep_Log Off
    Buffer_Size 0
    Kube_Meta_Cache_TTL 300s
`,
      'output.conf': `\
[OUTPUT]
    Name cloudwatch_logs
    Match   kube.*
    region ${aws.config.requireRegion()}
    log_group_name my-logs
    log_stream_prefix from-fluent-bit-
    log_retention_days 60
    auto_create_group true
`,
      'parsers.conf': `\
[PARSER]
    Name crio
    Format Regex
    Regex ^(?<time>[^ ]+) (?<stream>stdout|stderr) (?<logtag>P|F) (?<log>.*)$
    Time_Key    time
    Time_Format %Y-%m-%dT%H:%M:%S.%L%z
`,
    },
  });
}
