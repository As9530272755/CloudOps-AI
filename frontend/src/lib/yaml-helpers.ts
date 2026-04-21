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

export interface HorizontalPodAutoscalerFormData extends FormData {
  scaleTargetRef: { apiVersion: string; kind: string; name: string }
  minReplicas: number
  maxReplicas: number
  targetCPUUtilizationPercentage: number
}

export interface IngressFormData extends FormData {
  ingressClassName: string
  rules: {
    host: string
    paths: {
      path: string
      pathType: 'Prefix' | 'Exact' | 'ImplementationSpecific'
      serviceName: string
      servicePort: number
    }[]
  }[]
  tls: { hosts: string; secretName: string }[]
}

export interface NetworkPolicyFormData extends FormData {
  podSelector: { key: string; value: string }
  policyTypes: string[]
}

export interface PodDisruptionBudgetFormData extends FormData {
  minAvailable: string
  maxUnavailable: string
  selector: { key: string; value: string }
}

export interface EndpointSliceEndpoint {
  addresses: string
  conditionsReady: boolean
}

export interface EndpointSlicePort {
  name: string
  port: number
  protocol: 'TCP' | 'UDP'
}

export interface EndpointSliceFormData extends FormData {
  addressType: 'IPv4' | 'IPv6' | 'FQDN'
  endpoints: EndpointSliceEndpoint[]
  ports: EndpointSlicePort[]
}

export interface ReplicationControllerFormData extends FormData {
  replicas: number
  image: string
  port: number
}

export interface VolumeClaimTemplate {
  name: string
  storageClassName: string
  accessModes: string
  storage: string
}

export interface StatefulSetFormData extends FormData {
  replicas: number
  serviceName: string
  image: string
  port: number
  volumeClaimTemplates: VolumeClaimTemplate[]
}

export interface DaemonSetFormData extends FormData {
  image: string
  port: number
  nodeSelector: { key: string; value: string }[]
}

export interface ReplicaSetFormData extends FormData {
  replicas: number
  image: string
  port: number
}

export interface JobFormData extends FormData {
  image: string
  command: string
  completions: number
  parallelism: number
  restartPolicy: 'Never' | 'OnFailure'
}

export interface CronJobFormData extends FormData {
  schedule: string
  image: string
  command: string
  suspend: boolean
}

export interface LimitRangeItem {
  type: string
  max: { key: string; value: string }[]
  min: { key: string; value: string }[]
  default: { key: string; value: string }[]
  defaultRequest: { key: string; value: string }[]
}

export interface LimitRangeFormData extends FormData {
  limits: LimitRangeItem[]
}

export interface ResourceQuotaFormData extends FormData {
  hard: { key: string; value: string }[]
}

export interface LeaseFormData extends FormData {
  holderIdentity: string
  leaseDurationSeconds: number
}

export interface EndpointFormData extends FormData {
  subsets: { addresses: string; ports: { name: string; port: number; protocol: 'TCP' | 'UDP' }[] }[]
}

export interface PersistentVolumeFormData extends FormData {
  capacity: string
  accessModes: string[]
  persistentVolumeReclaimPolicy: 'Retain' | 'Recycle' | 'Delete'
  storageClassName: string
  hostPath: string
}

export interface PersistentVolumeClaimFormData extends FormData {
  accessModes: string[]
  storageClassName: string
  resources: { requests: { storage: string } }
}

export interface StorageClassFormData extends FormData {
  provisioner: string
  reclaimPolicy: 'Delete' | 'Retain'
  volumeBindingMode: 'Immediate' | 'WaitForFirstConsumer'
  allowVolumeExpansion: boolean
}

export interface ServiceAccountFormData extends FormData {}

export interface RoleRule {
  apiGroups: string
  resources: string
  verbs: string
}

export interface RoleFormData extends FormData {
  rules: RoleRule[]
}

export interface RoleBindingFormData extends FormData {
  roleRef: { kind: string; name: string }
  subjects: { kind: string; name: string; namespace: string }[]
}

export interface ClusterRoleFormData extends FormData {
  rules: RoleRule[]
}

export interface ClusterRoleBindingFormData extends FormData {
  roleRef: { kind: string; name: string }
  subjects: { kind: string; name: string; namespace: string }[]
}

export interface NamespaceFormData extends FormData {
  labels: { key: string; value: string }[]
}

export interface NodeFormData extends FormData {
  labels: { key: string; value: string }[]
}

export interface EventFormData extends FormData {
  reason: string
  message: string
  type: 'Normal' | 'Warning'
  involvedObject: { kind: string; name: string }
}

export interface CustomResourceDefinitionFormData extends FormData {
  group: string
  versions: string[]
  scope: 'Namespaced' | 'Cluster'
  names: { kind: string; plural: string; singular: string; shortNames: string[] }
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

// ===================== HorizontalPodAutoscaler =====================

export function horizontalPodAutoscalerFormToManifest(data: HorizontalPodAutoscalerFormData): any {
  return {
    apiVersion: 'autoscaling/v2',
    kind: 'HorizontalPodAutoscaler',
    metadata: {
      name: data.name,
      namespace: data.namespace,
    },
    spec: {
      scaleTargetRef: data.scaleTargetRef,
      minReplicas: data.minReplicas,
      maxReplicas: data.maxReplicas,
      metrics: [
        {
          type: 'Resource',
          resource: {
            name: 'cpu',
            target: {
              type: 'Utilization',
              averageUtilization: data.targetCPUUtilizationPercentage,
            },
          },
        },
      ],
    },
  }
}

export function manifestToHorizontalPodAutoscalerForm(manifest: any): HorizontalPodAutoscalerFormData | null {
  try {
    const metric = manifest.spec?.metrics?.[0]?.resource
    return {
      name: manifest.metadata?.name || '',
      namespace: manifest.metadata?.namespace || 'default',
      scaleTargetRef: {
        apiVersion: manifest.spec?.scaleTargetRef?.apiVersion || 'apps/v1',
        kind: manifest.spec?.scaleTargetRef?.kind || 'Deployment',
        name: manifest.spec?.scaleTargetRef?.name || '',
      },
      minReplicas: manifest.spec?.minReplicas || 1,
      maxReplicas: manifest.spec?.maxReplicas || 10,
      targetCPUUtilizationPercentage: metric?.target?.averageUtilization || 50,
    }
  } catch {
    return null
  }
}

// ===================== Ingress =====================

export function ingressFormToManifest(data: IngressFormData): any {
  const manifest: any = {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'Ingress',
    metadata: {
      name: data.name,
      namespace: data.namespace,
    },
    spec: {},
  }
  if (data.ingressClassName) {
    manifest.spec.ingressClassName = data.ingressClassName
  }
  const rules = data.rules
    .filter((r) => r.host)
    .map((r) => ({
      host: r.host,
      http: {
        paths: r.paths
          .filter((p) => p.path && p.serviceName)
          .map((p) => ({
            path: p.path,
            pathType: p.pathType,
            backend: {
              service: {
                name: p.serviceName,
                port: {
                  number: p.servicePort,
                },
              },
            },
          })),
      },
    }))
  if (rules.length > 0) {
    manifest.spec.rules = rules
  }
  const tls = data.tls
    .filter((t) => t.secretName)
    .map((t) => ({
      hosts: t.hosts.split(',').map((h) => h.trim()).filter(Boolean),
      secretName: t.secretName,
    }))
  if (tls.length > 0) {
    manifest.spec.tls = tls
  }
  return manifest
}

export function manifestToIngressForm(manifest: any): IngressFormData | null {
  try {
    return {
      name: manifest.metadata?.name || '',
      namespace: manifest.metadata?.namespace || 'default',
      ingressClassName: manifest.spec?.ingressClassName || '',
      rules: (manifest.spec?.rules || []).map((r: any) => ({
        host: r.host || '',
        paths: (r.http?.paths || []).map((p: any) => ({
          path: p.path || '',
          pathType: p.pathType || 'Prefix',
          serviceName: p.backend?.service?.name || '',
          servicePort: p.backend?.service?.port?.number || 80,
        })),
      })),
      tls: (manifest.spec?.tls || []).map((t: any) => ({
        hosts: Array.isArray(t.hosts) ? t.hosts.join(', ') : String(t.hosts || ''),
        secretName: t.secretName || '',
      })),
    }
  } catch {
    return null
  }
}

// ===================== NetworkPolicy =====================

export function networkPolicyFormToManifest(data: NetworkPolicyFormData): any {
  const manifest: any = {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'NetworkPolicy',
    metadata: {
      name: data.name,
      namespace: data.namespace,
    },
    spec: {
      policyTypes: data.policyTypes,
    },
  }
  if (data.podSelector.key && data.podSelector.value) {
    manifest.spec.podSelector = {
      matchLabels: { [data.podSelector.key]: data.podSelector.value },
    }
  } else {
    manifest.spec.podSelector = {}
  }
  return manifest
}

export function manifestToNetworkPolicyForm(manifest: any): NetworkPolicyFormData | null {
  try {
    const selector = manifest.spec?.podSelector?.matchLabels || {}
    const keys = Object.keys(selector)
    return {
      name: manifest.metadata?.name || '',
      namespace: manifest.metadata?.namespace || 'default',
      podSelector: {
        key: keys[0] || 'app',
        value: selector[keys[0]] || '',
      },
      policyTypes: manifest.spec?.policyTypes || ['Ingress'],
    }
  } catch {
    return null
  }
}

// ===================== PodDisruptionBudget =====================

export function podDisruptionBudgetFormToManifest(data: PodDisruptionBudgetFormData): any {
  const manifest: any = {
    apiVersion: 'policy/v1',
    kind: 'PodDisruptionBudget',
    metadata: {
      name: data.name,
      namespace: data.namespace,
    },
    spec: {},
  }
  if (data.minAvailable) {
    manifest.spec.minAvailable = data.minAvailable
  }
  if (data.maxUnavailable) {
    manifest.spec.maxUnavailable = data.maxUnavailable
  }
  if (data.selector.key && data.selector.value) {
    manifest.spec.selector = {
      matchLabels: { [data.selector.key]: data.selector.value },
    }
  }
  return manifest
}

export function manifestToPodDisruptionBudgetForm(manifest: any): PodDisruptionBudgetFormData | null {
  try {
    const selector = manifest.spec?.selector?.matchLabels || {}
    const keys = Object.keys(selector)
    return {
      name: manifest.metadata?.name || '',
      namespace: manifest.metadata?.namespace || 'default',
      minAvailable: String(manifest.spec?.minAvailable || '1'),
      maxUnavailable: String(manifest.spec?.maxUnavailable || ''),
      selector: {
        key: keys[0] || 'app',
        value: selector[keys[0]] || '',
      },
    }
  } catch {
    return null
  }
}

// ===================== EndpointSlice =====================

export function endpointSliceFormToManifest(data: EndpointSliceFormData): any {
  return {
    apiVersion: 'discovery.k8s.io/v1',
    kind: 'EndpointSlice',
    metadata: {
      name: data.name,
      namespace: data.namespace,
    },
    addressType: data.addressType,
    endpoints: data.endpoints
      .filter((ep) => ep.addresses)
      .map((ep) => ({
        addresses: ep.addresses.split(',').map((a) => a.trim()),
        conditions: { ready: ep.conditionsReady },
      })),
    ports: data.ports
      .filter((p) => p.port > 0)
      .map((p) => ({
        name: p.name || `port-${p.port}`,
        port: p.port,
        protocol: p.protocol,
      })),
  }
}

export function manifestToEndpointSliceForm(manifest: any): EndpointSliceFormData | null {
  try {
    return {
      name: manifest.metadata?.name || '',
      namespace: manifest.metadata?.namespace || 'default',
      addressType: manifest.addressType || 'IPv4',
      endpoints: (manifest.endpoints || []).map((ep: any) => ({
        addresses: Array.isArray(ep.addresses) ? ep.addresses.join(', ') : String(ep.addresses || ''),
        conditionsReady: ep.conditions?.ready !== false,
      })),
      ports: (manifest.ports || []).map((p: any) => ({
        name: p.name || '',
        port: p.port || 0,
        protocol: p.protocol || 'TCP',
      })),
    }
  } catch {
    return null
  }
}

// ===================== ReplicationController =====================

export function replicationControllerFormToManifest(data: ReplicationControllerFormData): any {
  const manifest: any = {
    apiVersion: 'v1',
    kind: 'ReplicationController',
    metadata: {
      name: data.name,
      namespace: data.namespace,
    },
    spec: {
      replicas: data.replicas,
      selector: { app: data.name },
      template: {
        metadata: { labels: { app: data.name } },
        spec: {
          containers: [
            {
              name: data.name,
              image: data.image,
            },
          ],
        },
      },
    },
  }
  if (data.port > 0) {
    manifest.spec.template.spec.containers[0].ports = [{ containerPort: data.port }]
  }
  return manifest
}

export function manifestToReplicationControllerForm(manifest: any): ReplicationControllerFormData | null {
  try {
    const container = manifest.spec?.template?.spec?.containers?.[0] || {}
    return {
      name: manifest.metadata?.name || '',
      namespace: manifest.metadata?.namespace || 'default',
      replicas: manifest.spec?.replicas || 1,
      image: container.image || '',
      port: container.ports?.[0]?.containerPort || 0,
    }
  } catch {
    return null
  }
}

// ===================== StatefulSet =====================

export function statefulSetFormToManifest(data: StatefulSetFormData): any {
  const manifest: any = {
    apiVersion: 'apps/v1',
    kind: 'StatefulSet',
    metadata: {
      name: data.name,
      namespace: data.namespace,
    },
    spec: {
      serviceName: data.serviceName || data.name,
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
              name: 'main',
              image: data.image,
              ports: data.port > 0 ? [{ containerPort: data.port }] : undefined,
            },
          ],
        },
      },
    },
  }
  if (data.volumeClaimTemplates.length > 0) {
    manifest.spec.volumeClaimTemplates = data.volumeClaimTemplates.map((vct) => ({
      metadata: { name: vct.name },
      spec: {
        accessModes: [vct.accessModes],
        storageClassName: vct.storageClassName || undefined,
        resources: {
          requests: {
            storage: vct.storage,
          },
        },
      },
    }))
  }
  return manifest
}

export function manifestToStatefulSetForm(manifest: any): StatefulSetFormData | null {
  try {
    const container = manifest.spec?.template?.spec?.containers?.[0] || {}
    const vcts = manifest.spec?.volumeClaimTemplates || []
    return {
      name: manifest.metadata?.name || '',
      namespace: manifest.metadata?.namespace || 'default',
      replicas: manifest.spec?.replicas || 1,
      serviceName: manifest.spec?.serviceName || '',
      image: container.image || '',
      port: container.ports?.[0]?.containerPort || 0,
      volumeClaimTemplates: vcts.map((vct: any) => ({
        name: vct.metadata?.name || '',
        storageClassName: vct.spec?.storageClassName || '',
        accessModes: vct.spec?.accessModes?.[0] || 'ReadWriteOnce',
        storage: vct.spec?.resources?.requests?.storage || '1Gi',
      })),
    }
  } catch {
    return null
  }
}

// ===================== DaemonSet =====================

export function daemonSetFormToManifest(data: DaemonSetFormData): any {
  const manifest: any = {
    apiVersion: 'apps/v1',
    kind: 'DaemonSet',
    metadata: {
      name: data.name,
      namespace: data.namespace,
    },
    spec: {
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
              name: 'main',
              image: data.image,
              ports: data.port > 0 ? [{ containerPort: data.port }] : undefined,
            },
          ],
        },
      },
    },
  }
  const nodeSelector: Record<string, string> = {}
  data.nodeSelector.forEach((item) => {
    if (item.key) nodeSelector[item.key] = item.value
  })
  if (Object.keys(nodeSelector).length) {
    manifest.spec.template.spec.nodeSelector = nodeSelector
  }
  return manifest
}

export function manifestToDaemonSetForm(manifest: any): DaemonSetFormData | null {
  try {
    const container = manifest.spec?.template?.spec?.containers?.[0] || {}
    const nodeSelector = manifest.spec?.template?.spec?.nodeSelector || {}
    return {
      name: manifest.metadata?.name || '',
      namespace: manifest.metadata?.namespace || 'default',
      image: container.image || '',
      port: container.ports?.[0]?.containerPort || 0,
      nodeSelector: Object.entries(nodeSelector).map(([key, value]) => ({ key, value: String(value) })),
    }
  } catch {
    return null
  }
}

// ===================== ReplicaSet =====================

export function replicaSetFormToManifest(data: ReplicaSetFormData): any {
  const manifest: any = {
    apiVersion: 'apps/v1',
    kind: 'ReplicaSet',
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
              name: 'main',
              image: data.image,
            },
          ],
        },
      },
    },
  }
  if (data.port > 0) {
    manifest.spec.template.spec.containers[0].ports = [{ containerPort: data.port }]
  }
  return manifest
}

export function manifestToReplicaSetForm(manifest: any): ReplicaSetFormData | null {
  try {
    const container = manifest.spec?.template?.spec?.containers?.[0] || {}
    return {
      name: manifest.metadata?.name || '',
      namespace: manifest.metadata?.namespace || 'default',
      replicas: manifest.spec?.replicas || 1,
      image: container.image || '',
      port: container.ports?.[0]?.containerPort || 0,
    }
  } catch {
    return null
  }
}

// ===================== Job =====================

export function jobFormToManifest(data: JobFormData): any {
  const manifest: any = {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: {
      name: data.name,
      namespace: data.namespace,
    },
    spec: {
      completions: data.completions,
      parallelism: data.parallelism,
      template: {
        spec: {
          restartPolicy: data.restartPolicy,
          containers: [
            {
              name: 'main',
              image: data.image,
            },
          ],
        },
      },
    },
  }
  if (data.command) {
    manifest.spec.template.spec.containers[0].command = data.command.split(' ').filter(Boolean)
  }
  return manifest
}

export function manifestToJobForm(manifest: any): JobFormData | null {
  try {
    const container = manifest.spec?.template?.spec?.containers?.[0] || {}
    return {
      name: manifest.metadata?.name || '',
      namespace: manifest.metadata?.namespace || 'default',
      image: container.image || '',
      command: (container.command || []).join(' '),
      completions: manifest.spec?.completions || 1,
      parallelism: manifest.spec?.parallelism || 1,
      restartPolicy: manifest.spec?.template?.spec?.restartPolicy || 'Never',
    }
  } catch {
    return null
  }
}

// ===================== CronJob =====================

export function cronJobFormToManifest(data: CronJobFormData): any {
  const manifest: any = {
    apiVersion: 'batch/v1',
    kind: 'CronJob',
    metadata: {
      name: data.name,
      namespace: data.namespace,
    },
    spec: {
      schedule: data.schedule,
      suspend: data.suspend,
      jobTemplate: {
        spec: {
          template: {
            spec: {
              restartPolicy: 'OnFailure',
              containers: [
                {
                  name: 'main',
                  image: data.image,
                },
              ],
            },
          },
        },
      },
    },
  }
  if (data.command) {
    manifest.spec.jobTemplate.spec.template.spec.containers[0].command = data.command.split(' ').filter(Boolean)
  }
  return manifest
}

export function manifestToCronJobForm(manifest: any): CronJobFormData | null {
  try {
    const container = manifest.spec?.jobTemplate?.spec?.template?.spec?.containers?.[0] || {}
    return {
      name: manifest.metadata?.name || '',
      namespace: manifest.metadata?.namespace || 'default',
      schedule: manifest.spec?.schedule || '',
      image: container.image || '',
      command: (container.command || []).join(' '),
      suspend: manifest.spec?.suspend ?? false,
    }
  } catch {
    return null
  }
}

// ===================== LimitRange =====================

function kvArrayToObject(arr: { key: string; value: string }[]): Record<string, string> | undefined {
  const obj: Record<string, string> = {}
  arr.forEach((item) => {
    if (item.key) obj[item.key] = item.value
  })
  return Object.keys(obj).length ? obj : undefined
}

export function limitRangeFormToManifest(data: LimitRangeFormData): any {
  return {
    apiVersion: 'v1',
    kind: 'LimitRange',
    metadata: {
      name: data.name,
      namespace: data.namespace,
    },
    spec: {
      limits: data.limits.map((limit) => {
        const item: any = { type: limit.type }
        const max = kvArrayToObject(limit.max)
        const min = kvArrayToObject(limit.min)
        const def = kvArrayToObject(limit.default)
        const defReq = kvArrayToObject(limit.defaultRequest)
        if (max) item.max = max
        if (min) item.min = min
        if (def) item.default = def
        if (defReq) item.defaultRequest = defReq
        return item
      }),
    },
  }
}

export function manifestToLimitRangeForm(manifest: any): LimitRangeFormData | null {
  try {
    const objToKvArray = (obj: any): { key: string; value: string }[] => {
      if (!obj || typeof obj !== 'object') return []
      return Object.entries(obj).map(([key, value]) => ({ key, value: String(value) }))
    }
    return {
      name: manifest.metadata?.name || '',
      namespace: manifest.metadata?.namespace || 'default',
      limits: (manifest.spec?.limits || []).map((limit: any) => ({
        type: limit.type || 'Container',
        max: objToKvArray(limit.max),
        min: objToKvArray(limit.min),
        default: objToKvArray(limit.default),
        defaultRequest: objToKvArray(limit.defaultRequest),
      })),
    }
  } catch {
    return null
  }
}

// ===================== ResourceQuota =====================

export function resourceQuotaFormToManifest(data: ResourceQuotaFormData): any {
  const hard: Record<string, string> = {}
  data.hard.forEach((item) => {
    if (item.key) hard[item.key] = item.value
  })
  return {
    apiVersion: 'v1',
    kind: 'ResourceQuota',
    metadata: {
      name: data.name,
      namespace: data.namespace,
    },
    spec: { hard },
  }
}

export function manifestToResourceQuotaForm(manifest: any): ResourceQuotaFormData | null {
  try {
    const hard = manifest.spec?.hard || {}
    return {
      name: manifest.metadata?.name || '',
      namespace: manifest.metadata?.namespace || 'default',
      hard: Object.entries(hard).map(([key, value]) => ({ key, value: String(value) })),
    }
  } catch {
    return null
  }
}

// ===================== Lease =====================

export function leaseFormToManifest(data: LeaseFormData): any {
  const manifest: any = {
    apiVersion: 'coordination.k8s.io/v1',
    kind: 'Lease',
    metadata: {
      name: data.name,
      namespace: data.namespace,
    },
    spec: {},
  }
  if (data.holderIdentity) {
    manifest.spec.holderIdentity = data.holderIdentity
  }
  if (data.leaseDurationSeconds > 0) {
    manifest.spec.leaseDurationSeconds = data.leaseDurationSeconds
  }
  return manifest
}

export function manifestToLeaseForm(manifest: any): LeaseFormData | null {
  try {
    return {
      name: manifest.metadata?.name || '',
      namespace: manifest.metadata?.namespace || 'kube-system',
      holderIdentity: manifest.spec?.holderIdentity || '',
      leaseDurationSeconds: manifest.spec?.leaseDurationSeconds || 15,
    }
  } catch {
    return null
  }
}

// ===================== Endpoint =====================

export function endpointFormToManifest(data: EndpointFormData): any {
  return {
    apiVersion: 'v1',
    kind: 'Endpoints',
    metadata: {
      name: data.name,
      namespace: data.namespace,
    },
    subsets: data.subsets
      .filter((s) => s.addresses)
      .map((s) => ({
        addresses: s.addresses
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean)
          .map((ip) => ({ ip })),
        ports: s.ports
          .filter((p) => p.port > 0)
          .map((p) => ({
            name: p.name || `port-${p.port}`,
            port: p.port,
            protocol: p.protocol,
          })),
      })),
  }
}

export function manifestToEndpointForm(manifest: any): EndpointFormData | null {
  try {
    return {
      name: manifest.metadata?.name || '',
      namespace: manifest.metadata?.namespace || 'default',
      subsets: (manifest.subsets || []).map((s: any) => ({
        addresses: Array.isArray(s.addresses)
          ? s.addresses.map((a: any) => (typeof a === 'string' ? a : a.ip)).join(', ')
          : String(s.addresses || ''),
        ports: (s.ports || []).map((p: any) => ({
          name: p.name || '',
          port: p.port || 0,
          protocol: p.protocol || 'TCP',
        })),
      })),
    }
  } catch {
    return null
  }
}

// ===================== PersistentVolume =====================

export function persistentVolumeFormToManifest(data: PersistentVolumeFormData): any {
  const manifest: any = {
    apiVersion: 'v1',
    kind: 'PersistentVolume',
    metadata: {
      name: data.name,
    },
    spec: {
      capacity: {
        storage: data.capacity,
      },
      accessModes: data.accessModes,
      persistentVolumeReclaimPolicy: data.persistentVolumeReclaimPolicy,
    },
  }
  if (data.storageClassName) {
    manifest.spec.storageClassName = data.storageClassName
  }
  if (data.hostPath) {
    manifest.spec.hostPath = { path: data.hostPath }
  }
  return manifest
}

export function manifestToPersistentVolumeForm(manifest: any): PersistentVolumeFormData | null {
  try {
    return {
      name: manifest.metadata?.name || '',
      namespace: manifest.metadata?.namespace || 'default',
      capacity: manifest.spec?.capacity?.storage || '10Gi',
      accessModes: manifest.spec?.accessModes || ['ReadWriteOnce'],
      persistentVolumeReclaimPolicy: manifest.spec?.persistentVolumeReclaimPolicy || 'Retain',
      storageClassName: manifest.spec?.storageClassName || '',
      hostPath: manifest.spec?.hostPath?.path || '',
    }
  } catch {
    return null
  }
}

// ===================== PersistentVolumeClaim =====================

export function persistentVolumeClaimFormToManifest(data: PersistentVolumeClaimFormData): any {
  const manifest: any = {
    apiVersion: 'v1',
    kind: 'PersistentVolumeClaim',
    metadata: {
      name: data.name,
      namespace: data.namespace,
    },
    spec: {
      accessModes: data.accessModes,
      resources: {
        requests: {
          storage: data.resources.requests.storage,
        },
      },
    },
  }
  if (data.storageClassName) {
    manifest.spec.storageClassName = data.storageClassName
  }
  return manifest
}

export function manifestToPersistentVolumeClaimForm(manifest: any): PersistentVolumeClaimFormData | null {
  try {
    return {
      name: manifest.metadata?.name || '',
      namespace: manifest.metadata?.namespace || 'default',
      accessModes: manifest.spec?.accessModes || ['ReadWriteOnce'],
      storageClassName: manifest.spec?.storageClassName || '',
      resources: {
        requests: {
          storage: manifest.spec?.resources?.requests?.storage || '10Gi',
        },
      },
    }
  } catch {
    return null
  }
}

// ===================== StorageClass =====================

export function storageClassFormToManifest(data: StorageClassFormData): any {
  const manifest: any = {
    apiVersion: 'storage.k8s.io/v1',
    kind: 'StorageClass',
    metadata: {
      name: data.name,
    },
    provisioner: data.provisioner,
    reclaimPolicy: data.reclaimPolicy,
    volumeBindingMode: data.volumeBindingMode,
    allowVolumeExpansion: data.allowVolumeExpansion,
  }
  return manifest
}

export function manifestToStorageClassForm(manifest: any): StorageClassFormData | null {
  try {
    return {
      name: manifest.metadata?.name || '',
      namespace: manifest.metadata?.namespace || 'default',
      provisioner: manifest.provisioner || 'kubernetes.io/host-path',
      reclaimPolicy: manifest.reclaimPolicy || 'Delete',
      volumeBindingMode: manifest.volumeBindingMode || 'Immediate',
      allowVolumeExpansion: manifest.allowVolumeExpansion ?? false,
    }
  } catch {
    return null
  }
}

// ===================== ServiceAccount =====================

export function serviceAccountFormToManifest(data: ServiceAccountFormData): any {
  return {
    apiVersion: 'v1',
    kind: 'ServiceAccount',
    metadata: {
      name: data.name,
      namespace: data.namespace,
    },
  }
}

export function manifestToServiceAccountForm(manifest: any): ServiceAccountFormData | null {
  try {
    return {
      name: manifest.metadata?.name || '',
      namespace: manifest.metadata?.namespace || 'default',
    }
  } catch {
    return null
  }
}

// ===================== Role =====================

export function roleFormToManifest(data: RoleFormData): any {
  return {
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'Role',
    metadata: {
      name: data.name,
      namespace: data.namespace,
    },
    rules: data.rules
      .filter((r) => r.verbs)
      .map((r) => ({
        apiGroups: r.apiGroups.split(',').map((s) => s.trim()).filter(Boolean).map((s) => (s === '""' || s === "''" ? '' : s)),
        resources: r.resources.split(',').map((s) => s.trim()).filter(Boolean),
        verbs: r.verbs.split(',').map((s) => s.trim()).filter(Boolean),
      })),
  }
}

export function manifestToRoleForm(manifest: any): RoleFormData | null {
  try {
    return {
      name: manifest.metadata?.name || '',
      namespace: manifest.metadata?.namespace || 'default',
      rules: (manifest.rules || []).map((r: any) => ({
        apiGroups: Array.isArray(r.apiGroups) ? r.apiGroups.map((g: any) => (g === '' ? '""' : String(g))).join(', ') : String(r.apiGroups || ''),
        resources: Array.isArray(r.resources) ? r.resources.join(', ') : String(r.resources || ''),
        verbs: Array.isArray(r.verbs) ? r.verbs.join(', ') : String(r.verbs || ''),
      })),
    }
  } catch {
    return null
  }
}

// ===================== RoleBinding =====================

export function roleBindingFormToManifest(data: RoleBindingFormData): any {
  return {
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'RoleBinding',
    metadata: {
      name: data.name,
      namespace: data.namespace,
    },
    roleRef: {
      apiGroup: 'rbac.authorization.k8s.io',
      kind: data.roleRef.kind,
      name: data.roleRef.name,
    },
    subjects: data.subjects
      .filter((s) => s.name)
      .map((s) => {
        const subject: any = { kind: s.kind, name: s.name }
        if (s.kind === 'ServiceAccount' && s.namespace) {
          subject.namespace = s.namespace
        }
        return subject
      }),
  }
}

export function manifestToRoleBindingForm(manifest: any): RoleBindingFormData | null {
  try {
    return {
      name: manifest.metadata?.name || '',
      namespace: manifest.metadata?.namespace || 'default',
      roleRef: {
        kind: manifest.roleRef?.kind || 'Role',
        name: manifest.roleRef?.name || '',
      },
      subjects: (manifest.subjects || []).map((s: any) => ({
        kind: s.kind || 'ServiceAccount',
        name: s.name || '',
        namespace: s.namespace || '',
      })),
    }
  } catch {
    return null
  }
}

// ===================== ClusterRole =====================

export function clusterRoleFormToManifest(data: ClusterRoleFormData): any {
  return {
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'ClusterRole',
    metadata: {
      name: data.name,
    },
    rules: data.rules
      .filter((r) => r.verbs)
      .map((r) => ({
        apiGroups: r.apiGroups.split(',').map((s) => s.trim()).filter(Boolean).map((s) => (s === '""' || s === "''" ? '' : s)),
        resources: r.resources.split(',').map((s) => s.trim()).filter(Boolean),
        verbs: r.verbs.split(',').map((s) => s.trim()).filter(Boolean),
      })),
  }
}

export function manifestToClusterRoleForm(manifest: any): ClusterRoleFormData | null {
  try {
    return {
      name: manifest.metadata?.name || '',
      namespace: manifest.metadata?.namespace || 'default',
      rules: (manifest.rules || []).map((r: any) => ({
        apiGroups: Array.isArray(r.apiGroups) ? r.apiGroups.map((g: any) => (g === '' ? '""' : String(g))).join(', ') : String(r.apiGroups || ''),
        resources: Array.isArray(r.resources) ? r.resources.join(', ') : String(r.resources || ''),
        verbs: Array.isArray(r.verbs) ? r.verbs.join(', ') : String(r.verbs || ''),
      })),
    }
  } catch {
    return null
  }
}

// ===================== ClusterRoleBinding =====================

export function clusterRoleBindingFormToManifest(data: ClusterRoleBindingFormData): any {
  return {
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'ClusterRoleBinding',
    metadata: {
      name: data.name,
    },
    roleRef: {
      apiGroup: 'rbac.authorization.k8s.io',
      kind: data.roleRef.kind,
      name: data.roleRef.name,
    },
    subjects: data.subjects
      .filter((s) => s.name)
      .map((s) => {
        const subject: any = { kind: s.kind, name: s.name }
        if (s.kind === 'ServiceAccount' && s.namespace) {
          subject.namespace = s.namespace
        }
        return subject
      }),
  }
}

export function manifestToClusterRoleBindingForm(manifest: any): ClusterRoleBindingFormData | null {
  try {
    return {
      name: manifest.metadata?.name || '',
      namespace: manifest.metadata?.namespace || 'default',
      roleRef: {
        kind: manifest.roleRef?.kind || 'ClusterRole',
        name: manifest.roleRef?.name || '',
      },
      subjects: (manifest.subjects || []).map((s: any) => ({
        kind: s.kind || 'ServiceAccount',
        name: s.name || '',
        namespace: s.namespace || '',
      })),
    }
  } catch {
    return null
  }
}

// ===================== Namespace =====================

function labelsToObject(labels: { key: string; value: string }[]): Record<string, string> | undefined {
  const obj: Record<string, string> = {}
  labels.forEach((item) => {
    if (item.key) obj[item.key] = item.value
  })
  return Object.keys(obj).length ? obj : undefined
}

function objectToLabels(obj: any): { key: string; value: string }[] {
  if (!obj || typeof obj !== 'object') return []
  return Object.entries(obj).map(([key, value]) => ({ key, value: String(value) }))
}

export function namespaceFormToManifest(data: NamespaceFormData): any {
  const manifest: any = {
    apiVersion: 'v1',
    kind: 'Namespace',
    metadata: {
      name: data.name,
    },
  }
  const labels = labelsToObject(data.labels)
  if (labels) {
    manifest.metadata.labels = labels
  }
  return manifest
}

export function manifestToNamespaceForm(manifest: any): NamespaceFormData | null {
  try {
    return {
      name: manifest.metadata?.name || '',
      namespace: manifest.metadata?.namespace || 'default',
      labels: objectToLabels(manifest.metadata?.labels),
    }
  } catch {
    return null
  }
}

// ===================== Node =====================

export function nodeFormToManifest(data: NodeFormData): any {
  const manifest: any = {
    apiVersion: 'v1',
    kind: 'Node',
    metadata: {
      name: data.name,
    },
  }
  const labels = labelsToObject(data.labels)
  if (labels) {
    manifest.metadata.labels = labels
  }
  return manifest
}

export function manifestToNodeForm(manifest: any): NodeFormData | null {
  try {
    return {
      name: manifest.metadata?.name || '',
      namespace: manifest.metadata?.namespace || 'default',
      labels: objectToLabels(manifest.metadata?.labels),
    }
  } catch {
    return null
  }
}

// ===================== Event =====================

export function eventFormToManifest(data: EventFormData): any {
  return {
    apiVersion: 'v1',
    kind: 'Event',
    metadata: {
      name: data.name,
      namespace: data.namespace,
    },
    reason: data.reason,
    message: data.message,
    type: data.type,
    involvedObject: {
      kind: data.involvedObject.kind,
      name: data.involvedObject.name,
    },
  }
}

export function manifestToEventForm(manifest: any): EventFormData | null {
  try {
    return {
      name: manifest.metadata?.name || '',
      namespace: manifest.metadata?.namespace || 'default',
      reason: manifest.reason || '',
      message: manifest.message || '',
      type: manifest.type || 'Normal',
      involvedObject: {
        kind: manifest.involvedObject?.kind || '',
        name: manifest.involvedObject?.name || '',
      },
    }
  } catch {
    return null
  }
}

// ===================== CustomResourceDefinition =====================

export function customResourceDefinitionFormToManifest(data: CustomResourceDefinitionFormData): any {
  const manifest: any = {
    apiVersion: 'apiextensions.k8s.io/v1',
    kind: 'CustomResourceDefinition',
    metadata: {
      name: data.name,
    },
    spec: {
      group: data.group,
      versions: data.versions.map((v) => ({
        name: v,
        served: true,
        storage: true,
        schema: {
          openAPIV3Schema: {
            type: 'object',
            properties: {},
          },
        },
      })),
      scope: data.scope,
      names: {
        kind: data.names.kind,
        plural: data.names.plural,
        singular: data.names.singular,
      },
    },
  }
  if (data.names.shortNames.length) {
    manifest.spec.names.shortNames = data.names.shortNames
  }
  return manifest
}

export function manifestToCustomResourceDefinitionForm(manifest: any): CustomResourceDefinitionFormData | null {
  try {
    const spec = manifest.spec || {}
    const versions = (spec.versions || []).map((v: any) => (typeof v === 'string' ? v : v.name || '')).filter(Boolean)
    return {
      name: manifest.metadata?.name || '',
      namespace: manifest.metadata?.namespace || 'default',
      group: spec.group || '',
      versions: versions.length ? versions : ['v1'],
      scope: spec.scope || 'Namespaced',
      names: {
        kind: spec.names?.kind || '',
        plural: spec.names?.plural || '',
        singular: spec.names?.singular || '',
        shortNames: spec.names?.shortNames || [],
      },
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
    case 'horizontalpodautoscalers':
      return horizontalPodAutoscalerFormToManifest(data as HorizontalPodAutoscalerFormData)
    case 'ingresses':
      return ingressFormToManifest(data as IngressFormData)
    case 'networkpolicies':
      return networkPolicyFormToManifest(data as NetworkPolicyFormData)
    case 'poddisruptionbudgets':
      return podDisruptionBudgetFormToManifest(data as PodDisruptionBudgetFormData)
    case 'endpointslices':
      return endpointSliceFormToManifest(data as EndpointSliceFormData)
    case 'replicationcontrollers':
      return replicationControllerFormToManifest(data as ReplicationControllerFormData)
    case 'limitranges':
      return limitRangeFormToManifest(data as LimitRangeFormData)
    case 'resourcequotas':
      return resourceQuotaFormToManifest(data as ResourceQuotaFormData)
    case 'leases':
      return leaseFormToManifest(data as LeaseFormData)
    case 'statefulsets':
      return statefulSetFormToManifest(data as StatefulSetFormData)
    case 'daemonsets':
      return daemonSetFormToManifest(data as DaemonSetFormData)
    case 'replicasets':
      return replicaSetFormToManifest(data as ReplicaSetFormData)
    case 'jobs':
      return jobFormToManifest(data as JobFormData)
    case 'cronjobs':
      return cronJobFormToManifest(data as CronJobFormData)
    case 'endpoints':
      return endpointFormToManifest(data as EndpointFormData)
    case 'persistentvolumes':
      return persistentVolumeFormToManifest(data as PersistentVolumeFormData)
    case 'persistentvolumeclaims':
      return persistentVolumeClaimFormToManifest(data as PersistentVolumeClaimFormData)
    case 'storageclasses':
      return storageClassFormToManifest(data as StorageClassFormData)
    case 'serviceaccounts':
      return serviceAccountFormToManifest(data as ServiceAccountFormData)
    case 'roles':
      return roleFormToManifest(data as RoleFormData)
    case 'rolebindings':
      return roleBindingFormToManifest(data as RoleBindingFormData)
    case 'clusterroles':
      return clusterRoleFormToManifest(data as ClusterRoleFormData)
    case 'clusterrolebindings':
      return clusterRoleBindingFormToManifest(data as ClusterRoleBindingFormData)
    case 'namespaces':
      return namespaceFormToManifest(data as NamespaceFormData)
    case 'nodes':
      return nodeFormToManifest(data as NodeFormData)
    case 'events':
      return eventFormToManifest(data as EventFormData)
    case 'customresourcedefinitions':
      return customResourceDefinitionFormToManifest(data as CustomResourceDefinitionFormData)
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
    case 'horizontalpodautoscalers':
      return manifestToHorizontalPodAutoscalerForm(manifest)
    case 'ingresses':
      return manifestToIngressForm(manifest)
    case 'networkpolicies':
      return manifestToNetworkPolicyForm(manifest)
    case 'poddisruptionbudgets':
      return manifestToPodDisruptionBudgetForm(manifest)
    case 'endpointslices':
      return manifestToEndpointSliceForm(manifest)
    case 'replicationcontrollers':
      return manifestToReplicationControllerForm(manifest)
    case 'limitranges':
      return manifestToLimitRangeForm(manifest)
    case 'resourcequotas':
      return manifestToResourceQuotaForm(manifest)
    case 'leases':
      return manifestToLeaseForm(manifest)
    case 'statefulsets':
      return manifestToStatefulSetForm(manifest)
    case 'daemonsets':
      return manifestToDaemonSetForm(manifest)
    case 'replicasets':
      return manifestToReplicaSetForm(manifest)
    case 'jobs':
      return manifestToJobForm(manifest)
    case 'cronjobs':
      return manifestToCronJobForm(manifest)
    case 'endpoints':
      return manifestToEndpointForm(manifest)
    case 'persistentvolumes':
      return manifestToPersistentVolumeForm(manifest)
    case 'persistentvolumeclaims':
      return manifestToPersistentVolumeClaimForm(manifest)
    case 'storageclasses':
      return manifestToStorageClassForm(manifest)
    case 'serviceaccounts':
      return manifestToServiceAccountForm(manifest)
    case 'roles':
      return manifestToRoleForm(manifest)
    case 'rolebindings':
      return manifestToRoleBindingForm(manifest)
    case 'clusterroles':
      return manifestToClusterRoleForm(manifest)
    case 'clusterrolebindings':
      return manifestToClusterRoleBindingForm(manifest)
    case 'namespaces':
      return manifestToNamespaceForm(manifest)
    case 'nodes':
      return manifestToNodeForm(manifest)
    case 'events':
      return manifestToEventForm(manifest)
    case 'customresourcedefinitions':
      return manifestToCustomResourceDefinitionForm(manifest)
    default:
      return null
  }
}

// 是否支持表单模式
export function supportsFormMode(kind: string): boolean {
  return [
    'deployments', 'services', 'configmaps', 'secrets', 'pods',
    'horizontalpodautoscalers', 'ingresses', 'networkpolicies', 'poddisruptionbudgets',
    'endpointslices', 'replicationcontrollers', 'limitranges', 'resourcequotas',
    'leases',
    'statefulsets', 'daemonsets', 'replicasets', 'jobs', 'cronjobs',
    'endpoints', 'persistentvolumes', 'persistentvolumeclaims', 'storageclasses',
    'serviceaccounts', 'roles', 'rolebindings', 'clusterroles', 'clusterrolebindings',
    'namespaces', 'nodes', 'events', 'customresourcedefinitions',
  ].includes(kind)
}
