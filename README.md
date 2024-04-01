# Pulumi AI Cluster

This repository encompasses a collection of [Pulumi](https://www.pulumi.com/) projects configured to
deploy an AWS EKS cluster environment tailored for AI and machine learning applications.

- [Pulumi AI Cluster](#pulumi-ai-cluster)
  - [Connecting to the Cluster](#connecting-to-the-cluster)
  - [Deploying AI Workloads](#deploying-ai-workloads)
- [Projects Overview](#projects-overview)

## Connecting to the Cluster

First, you'll need `kubectl` and either `pulumi` or `esc` installed on your local machine. The
Kubernetes site has [documentation for installing
`kubectl`](https://kubernetes.io/docs/tasks/tools/).

Second, use the Pulumi organization's ESC environment to run one-off commands or open a subshell in
the environment:

```sh
# Run a single command:
pulumi env run ai-env-opal-quokka -- kubectl get pod

# Run several:
pulumi env run ai-env-opal-quokka -i -- $SHELL
```

## Deploying AI Workloads

See the [`llms` app](./infra/app-llms/index.ts) for an example deploying a large language model
using the [vLLM project](https://github.com/vllm-project/vllm).

# Projects Overview

- **[aws-vpc](infra/aws-vpc/index.ts)**: Network infrastructure on AWS, including a Virtual Private Cloud
  (VPC) to isolate resources, public and private subnets with NAT Gateways.

- **[eks-cluster](infra/eks-cluster/index.ts)**: Creates an AWS Elastic Kubernetes Service (EKS) cluster.
  This provisions a control plane only, with no worker nodes. It also configures `kubeconfig`,
  enabling users to interact with the cluster using Kubernetes’s command-line tool, `kubectl`.

- **[eks-karpenter](infra/eks-karpenter/index.ts)**: The [Karpenter.sh](infra/https://karpenter.sh/) project is
  deployed to auto-scale the cluster, provisioning worker nodes based on the workloads.

- **[eks-karpenter-gpu-nodes](infra/eks-karpenter/index.ts)**: This creates Karpenter node configurations
  for deploying A100 and A10 class GPUs - a variety are chosen due to varying spot yields.

- **[eks-l2](infra/eks-l2/index.ts)**: Enhances the cluster with additional services and configurations
  crucial for a robust Kubernetes environment:

  - **CloudWatch Logs for Fargate pods**: Enables logging for containers, facilitating monitoring
    and troubleshooting.
  - **Kube-proxy**: Manages IP address translation for services, enabling communication to and from
    Pods within the cluster.
  - **CoreDNS Upgrade**: Updates the DNS service within Kubernetes, used for resolving service names
    to IP addresses, improving cluster reliability and performance.
  - **AWS Pod Identity**: Integrates AWS IAM with Kubernetes, allowing Pods to assume AWS IAM roles
    and securely access AWS services.
  - **VPC CNI Plugin**: Implements the AWS VPC Container Network Interface (CNI) plugin, allowing
    Kubernetes Pods to have the same IP addresses as within the VPC, enhancing networking
    capabilities.
  - **EBS CSI Driver**: Enables the use of AWS Elastic Block Store (EBS) volumes for persistent
    storage with Kubernetes, supporting data persistence across Pod restarts or rescheduling.
  - **CloudWatch Observability**: Configures monitoring and logging for various EKS components,
    facilitating operational insights.

- **[eks-l3-istio](infra/eks-l3-istio/index.ts)**: Deploys [Istio](https://istio.io/), a service
  mesh, providing capabilities like routing, load balancing, monitoring, and security policies
  between services (microservices) within the EKS cluster. This is a prerequisite for kubeflow.

- **[app-kubeflow](infra/app-kubeflow/index.ts)**: Sets up [Kubeflow](https://www.kubeflow.org/), a
  Kubernetes-native platform for machine learning workflows. It simplifies the deployment of ML
  models and serves as an end-to-end solution for executing ML pipelines.

- **[app-llms](infra/app-llms/index.ts)**: Deploys a large language model using the `vLLM` inference
  server.
