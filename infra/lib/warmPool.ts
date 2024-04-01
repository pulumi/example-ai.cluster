import * as k8s from '@pulumi/kubernetes';

export function newWarmPool(provider: k8s.Provider): void {
  const appLabels = {
    'eks.pulumi.com/warm-capacity-pool': 'true',
  };

  const ns = new k8s.core.v1.Namespace('warm-pool', {}, { provider });

  new k8s.scheduling.v1.PriorityClass(
    'preempt-by-default',
    {
      value: 1_000,
      globalDefault: true,
      preemptionPolicy: 'PreemptLowerPriority',
    },
    { provider },
  );

  const warmPoolClass = new k8s.scheduling.v1.PriorityClass(
    'warm-pool',
    {
      value: -1_000_000,
      preemptionPolicy: 'Never',
    },
    { provider },
  );

  const warmCapacityLabels = {
    ...appLabels,
    'karpenter.sh/nodepool': 'default-nodes',
    'eks.pulumi.com/warm-capacity-pool': 'true',
  };

  new k8s.apps.v1.Deployment(
    'warm-capacity',
    {
      metadata: {
        namespace: ns.metadata.name,
        labels: warmCapacityLabels,
        annotations: {
          // pulumi skip await
          'pulumi.com/skipAwait': 'true',
        },
      },
      // Run registry.k8s.io/pause:3.5
      // With a very low priority
      // And a decent resource request (2cpu, 4GB ram)
      // And anti-affinity to spread them out and use multiple nodes
      spec: {
        selector: {
          matchLabels: warmCapacityLabels,
        },
        replicas: 1,
        template: {
          metadata: {
            labels: warmCapacityLabels,
          },
          spec: {
            priorityClassName: warmPoolClass.metadata.name,
            affinity: {
              podAntiAffinity: {
                requiredDuringSchedulingIgnoredDuringExecution: [
                  {
                    labelSelector: {
                      matchLabels: warmCapacityLabels,
                    },
                    topologyKey: 'kubernetes.io/hostname',
                  },
                ],
              },
            },
            containers: [
              {
                name: 'pause',
                image: 'registry.k8s.io/pause:3.5',
                imagePullPolicy: 'Always',
                resources: {
                  requests: {
                    cpu: '2',
                    memory: '8Gi',
                  },
                },
              },
            ],
          },
        },
      },
    },
    { provider, deletedWith: ns },
  );
}
