import yaml from 'js-yaml'

// ===================== 类型定义 =====================

export interface FormData {
  name: string
  namespace: string
  [key: string]: any
}

export interface PortMapping {
  name: string
  port: number
  targetPort: number
  protocol: 'TCP' | 'UDP'
  nodePort?: number
}

export interface EnvVar {
  name: string
  value: string
}

export interface DeploymentFormData extends FormData {
  image: string
  replicas: number
  ports: PortMapping[]
  env: EnvVar[]
}

export interface ServiceFormData extends FormData {
  type: 'ClusterIP' | 'NodePort' | 'LoadBalancer' | 'ExternalName'
  ports: PortMapping[]
  selector: { key: string; value: string }
}

export interface ConfigMapFormData extends FormData {
  data: { key: string; value: string }[]
}

export interface SecretFormData extends FormData {
  type: 'Opaque' | 'kubernetes.io/tls' | 'kubernetes.io/dockerconfigjson' | 'kubernetes.io/basic-auth'
  data: { key: string; value: string }[]
}

export interface PodFormData extends FormData {
  image: string
  restartPolicy: 'Always' | 'OnFailure' | 'Never'
}

// ===================== 通用工具 =====================

export function manifestToYaml(manifest: any): string {
  return yaml.dump(manifest, { indent: 2, lineWidth: -1 })
}

export function yamlToManifest(yamlStr: string): any {
  return yaml.load(yamlStr)
}

// ===================== Deployment =====================

export function deploymentFormToManifest(data: DeploymentFormData): any {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: {
      name: data.name,
      namespace: data.namespace,
    },
    spec: {
      replicas: data.replicas,
      selector: {
        matchLabels: {
          app: data.name,
        },
      },
      template: {
        metadata: {
          labels: {
            app: data.name,
          },
        },
        spec: {
          containers: [
            {
              name: data.name,
              image: data.image,
              ports: data.ports
                .filter((p) => p.port > 0)
                .map((p) => ({
                  name: p.name || `port-${p.port}`,
                  containerPort: p.targetPort || p.port,
                  protocol: p.protocol,
                })),
              env: data.env
                .filter((e) => e.name)
                .map((e) => ({ name: e.name, value: e.value })),
            },
          ],
        },
      },
    },
  }
}

export function manifestToDeploymentForm(manifest: any): DeploymentFormData | null {
  try {
    const spec = manifest.spec?.template?.spec?.containers?.[0] || {}
    return {
      name: manifest.metadata?.name || '',
      namespace: manifest.metadata?.namespace || 'default',
      image: spec.image || '',
      replicas: manifest.spec?.replicas || 1,
      ports: (spec.ports || []).map((p: any) => ({
        name: p.name || '',
        port: p.containerPort || 0,
        targetPort: p.containerPort || 0,
        protocol: p.protocol || 'TCP',
      })),
      env: (spec.env || []).map((e: any) => ({
        name: e.name || '',
        value: e.value || '',
      })),
    }
  } catch {
    return null
  }
}

// ===================== Service =====================

export function serviceFormToManifest(data: ServiceFormData): any {
  const ports = data.ports
    .filter((p) => p.port > 0)
    .map((p) => {
      const port: any = {
        name: p.name || `port-${p.port}`,
        port: p.port,
        targetPort: p.targetPort || p.port,
        protocol: p.protocol,
      }
      if (data.type === 'NodePort' && p.nodePort) {
        port.nodePort = p.nodePort
      }
      return port
    })

  const manifest: any = {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: {
      name: data.name,
      namespace: data.namespace,
    },
    spec: {
      type: data.type,
      ports,
    },
  }

  if (data.selector.key && data.selector.value) {
    manifest.spec.selector = { [data.selector.key]: data.selector.value }
  }

  return manifest
}

export function manifestToServiceForm(manifest: any): ServiceFormData | null {
  try {
    const selector = manifest.spec?.selector || {}
    const keys = Object.keys(selector)
    return {
      name: manifest.metadata?.name || '',
      namespace: manifest.metadata?.namespace || 'default',
      type: manifest.spec?.type || 'ClusterIP',
      ports: (manifest.spec?.ports || []).map((p: any) => ({
        name: p.name || '',
        port: p.port || 0,
        targetPort: p.targetPort || p.port || 0,
        protocol: p.protocol || 'TCP',
        nodePort: p.nodePort || undefined,
      })),
      selector: {
        key: keys[0] || 'app',
        value: selector[keys[0]] || '',
      },
    }
  } catch {
    return null
  }
}

// ===================== ConfigMap =====================

export function configMapFormToManifest(data: ConfigMapFormData): any {
  const cmData: Record<string, string> = {}
  data.data.forEach((item) => {
    if (item.key) cmData[item.key] = item.value
  })
  return {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: {
      name: data.name,
      namespace: data.namespace,
    },
    data: cmData,
  }
}

export function manifestToConfigMapForm(manifest: any): ConfigMapFormData | null {
  try {
    const data = manifest.data || {}
    return {
      name: manifest.metadata?.name || '',
      namespace: manifest.metadata?.namespace || 'default',
      data: Object.entries(data).map(([key, value]) => ({ key, value: String(value) })),
    }
  } catch {
    return null
  }
}

// ===================== Secret =====================

export function secretFormToManifest(data: SecretFormData): any {
  const secretData: Record<string, string> = {}
  data.data.forEach((item) => {
    if (item.key) secretData[item.key] = btoa(item.value)
  })
  return {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: {
      name: data.name,
      namespace: data.namespace,
    },
    type: data.type,
    data: secretData,
  }
}

export function manifestToSecretForm(manifest: any): SecretFormData | null {
  try {
    const data = manifest.data || {}
    return {
      name: manifest.metadata?.name || '',
      namespace: manifest.metadata?.namespace || 'default',
      type: manifest.type || 'Opaque',
      data: Object.entries(data).map(([key, value]) => ({
        key,
        value: typeof value === 'string' ? atob(value) : String(value),
      })),
    }
  } catch {
    return null
  }
}

// ===================== Pod =====================

export function podFormToManifest(data: PodFormData): any {
  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: data.name,
      namespace: data.namespace,
    },
    spec: {
      containers: [
        {
          name: data.name,
          image: data.image,
        },
      ],
      restartPolicy: data.restartPolicy,
    },
  }
}

export function manifestToPodForm(manifest: any): PodFormData | null {
  try {
    const container = manifest.spec?.containers?.[0] || {}
    return {
      name: manifest.metadata?.name || '',
      namespace: manifest.metadata?.namespace || 'default',
      image: container.image || '',
      restartPolicy: manifest.spec?.restartPolicy || 'Always',
    }
  } catch {
    return null
  }
}

// ===================== 统一路由 =====================

export function generateManifest(kind: string, data: FormData): any {
  switch (kind) {
    case 'deployments':
      return deploymentFormToManifest(data as DeploymentFormData)
    case 'services':
      return serviceFormToManifest(data as ServiceFormData)
    case 'configmaps':
      return configMapFormToManifest(data as ConfigMapFormData)
    case 'secrets':
      return secretFormToManifest(data as SecretFormData)
    case 'pods':
      return podFormToManifest(data as PodFormData)
    default:
      throw new Error(`不支持的资源类型: ${kind}`)
  }
}

export function parseManifest(kind: string, manifest: any): FormData | null {
  switch (kind) {
    case 'deployments':
      return manifestToDeploymentForm(manifest)
    case 'services':
      return manifestToServiceForm(manifest)
    case 'configmaps':
      return manifestToConfigMapForm(manifest)
    case 'secrets':
      return manifestToSecretForm(manifest)
    case 'pods':
      return manifestToPodForm(manifest)
    default:
      return null
  }
}

// 是否支持表单模式
export function supportsFormMode(kind: string): boolean {
  return ['deployments', 'services', 'configmaps', 'secrets', 'pods'].includes(kind)
}
