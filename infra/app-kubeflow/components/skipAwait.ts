import * as pulumi from '@pulumi/pulumi';

function annotator(annotations: Record<string, string>) {
  return (obj: any, opts: pulumi.CustomResourceOptions): void => {
    if (typeof obj === 'object' && obj !== null) {
      if ('metadata' in obj && typeof obj.metadata === 'object' && obj.metadata !== null) {
        if ('annotations' in obj.metadata && typeof obj.metadata.annotations === 'object' && obj.metadata.annotations !== null) {
          obj.metadata.annotations = { ...obj.metadata.annotations, ...annotations };
        } else {
          obj.metadata.annotations = annotations;
        }
      }
    }
  };
}

export const skipAwait = annotator({ 'pulumi.com/skipAwait': 'true' });
export const patchForce = annotator({ 'pulumi.com/patchForce': 'true' });

function objIsClusterResource(obj: object): boolean {
  if ('metadata' in obj && typeof obj.metadata === 'object' && obj.metadata !== null && 'namespace' in obj.metadata) {
    return false;
  }

  return true;
}

// If the kind is CustomResourceDefinition, set its apiVersion to 'v1', kind to 'List', and delete
// all other fields. This causes Pulumi to treat the resource as a no-op.
function removeItem(obj: any): void {
  for (const key of Object.keys(obj)) {
    if (key !== 'apiVersion' && key !== 'kind') {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete obj[key];
    }
  }
  obj.apiVersion = 'v1';
  obj.kind = 'List';
  obj.items = [];
}

export function clusterResources(obj: any, opts: pulumi.CustomResourceOptions): void {
  if (typeof obj === 'object' && obj !== null) {
    if (objIsClusterResource(obj)) {
      removeItem(obj);
    }
  }
}

export function namespacedResources(obj: any, opts: pulumi.CustomResourceOptions): void {
  if (typeof obj === 'object' && obj !== null) {
    if (!objIsClusterResource(obj)) {
      removeItem(obj);
    }
  }
}
