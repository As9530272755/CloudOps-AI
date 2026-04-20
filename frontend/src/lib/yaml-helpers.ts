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

export interface CertificateSigningRequestFormData extends FormData {
  signerName: string
  request: string
  usages: string[]
}

export interface PriorityClassFormData extends FormData {
  value: number
  globalDefault: boolean
  description: string
}

export interface LeaseFormData extends FormData {
  holderIdentity: string
  leaseDurationSeconds: number
}

export interface RuntimeClassFormData extends FormData {
  handler: string
  overhead: { cpu: string; memory: string }
  scheduling: { key: string; value: string }[]
}

export interface VolumeAttachmentFormData extends FormData {
  attacher: string
  nodeName: string
  source: { persistentVolumeName: string }
}

export interface CSIDriverFormData extends FormData {
  attachRequired: boolean
  podInfoOnMount: boolean
  volumeLifecycleModes: string[]
}

export interface CSINodeDriver {
  name: string
  nodeID: string
  topologyKeys: string
}

export interface CSINodeFormData extends FormData {
  drivers: CSINodeDriver[]
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

// ===================== CertificateSigningRequest =====================

export function certificateSigningRequestFormToManifest(data: CertificateSigningRequestFormData): any {
  return {
    apiVersion: 'certificates.k8s.io/v1',
    kind: 'CertificateSigningRequest',
    metadata: {
      name: data.name,
      namespace: data.namespace,
    },
    spec: {
      signerName: data.signerName,
      request: data.request,
      usages: data.usages,
    },
  }
}

export function manifestToCertificateSigningRequestForm(manifest: any): CertificateSigningRequestFormData | null {
  try {
    return {
      name: manifest.metadata?.name || '',
      namespace: manifest.metadata?.namespace || 'default',
      signerName: manifest.spec?.signerName || '',
      request: manifest.spec?.request || '',
      usages: manifest.spec?.usages || [],
    }
  } catch {
    return null
  }
}

// ===================== PriorityClass =====================

export function priorityClassFormToManifest(data: PriorityClassFormData): any {
  const manifest: any = {
    apiVersion: 'scheduling.k8s.io/v1',
    kind: 'PriorityClass',
    metadata: {
      name: data.name,
    },
    value: data.value,
    globalDefault: data.globalDefault,
  }
  if (data.description) {
    manifest.description = data.description
  }
  return manifest
}

export function manifestToPriorityClassForm(manifest: any): PriorityClassFormData | null {
  try {
    return {
      name: manifest.metadata?.name || '',
      namespace: manifest.metadata?.namespace || 'default',
      value: manifest.value ?? 1000,
      globalDefault: manifest.globalDefault ?? false,
      description: manifest.description || '',
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

// ===================== RuntimeClass =====================

export function runtimeClassFormToManifest(data: RuntimeClassFormData): any {
  const manifest: any = {
    apiVersion: 'node.k8s.io/v1',
    kind: 'RuntimeClass',
    metadata: {
      name: data.name,
      namespace: data.namespace,
    },
    handler: data.handler,
  }
  const overhead: Record<string, string> = {}
  if (data.overhead.cpu) overhead.cpu = data.overhead.cpu
  if (data.overhead.memory) overhead.memory = data.overhead.memory
  if (Object.keys(overhead).length) {
    manifest.overhead = { podFixed: overhead }
  }
  const nodeSelector: Record<string, string> = {}
  data.scheduling.forEach((item) => {
    if (item.key) nodeSelector[item.key] = item.value
  })
  if (Object.keys(nodeSelector).length) {
    manifest.scheduling = { nodeSelector }
  }
  return manifest
}

export function manifestToRuntimeClassForm(manifest: any): RuntimeClassFormData | null {
  try {
    const podFixed = manifest.overhead?.podFixed || {}
    const nodeSelector = manifest.scheduling?.nodeSelector || {}
    return {
      name: manifest.metadata?.name || '',
      namespace: manifest.metadata?.namespace || 'default',
      handler: manifest.handler || '',
      overhead: {
        cpu: podFixed.cpu || '',
        memory: podFixed.memory || '',
      },
      scheduling: Object.entries(nodeSelector).map(([key, value]) => ({ key, value: String(value) })),
    }
  } catch {
    return null
  }
}

// ===================== VolumeAttachment =====================

export function volumeAttachmentFormToManifest(data: VolumeAttachmentFormData): any {
  const manifest: any = {
    apiVersion: 'storage.k8s.io/v1',
    kind: 'VolumeAttachment',
    metadata: {
      name: data.name,
      namespace: data.namespace,
    },
    spec: {
      attacher: data.attacher,
      nodeName: data.nodeName,
      source: {},
    },
  }
  if (data.source.persistentVolumeName) {
    manifest.spec.source.persistentVolumeName = data.source.persistentVolumeName
  }
  return manifest
}

export function manifestToVolumeAttachmentForm(manifest: any): VolumeAttachmentFormData | null {
  try {
    return {
      name: manifest.metadata?.name || '',
      namespace: manifest.metadata?.namespace || 'default',
      attacher: manifest.spec?.attacher || '',
      nodeName: manifest.spec?.nodeName || '',
      source: {
        persistentVolumeName: manifest.spec?.source?.persistentVolumeName || '',
      },
    }
  } catch {
    return null
  }
}

// ===================== CSIDriver =====================

export function csiDriverFormToManifest(data: CSIDriverFormData): any {
  return {
    apiVersion: 'storage.k8s.io/v1',
    kind: 'CSIDriver',
    metadata: {
      name: data.name,
      namespace: data.namespace,
    },
    spec: {
      attachRequired: data.attachRequired,
      podInfoOnMount: data.podInfoOnMount,
      volumeLifecycleModes: data.volumeLifecycleModes,
    },
  }
}

export function manifestToCSIDriverForm(manifest: any): CSIDriverFormData | null {
  try {
    return {
      name: manifest.metadata?.name || '',
      namespace: manifest.metadata?.namespace || 'default',
      attachRequired: manifest.spec?.attachRequired !== false,
      podInfoOnMount: manifest.spec?.podInfoOnMount ?? false,
      volumeLifecycleModes: manifest.spec?.volumeLifecycleModes || ['Persistent'],
    }
  } catch {
    return null
  }
}

// ===================== CSINode =====================

export function csiNodeFormToManifest(data: CSINodeFormData): any {
  return {
    apiVersion: 'storage.k8s.io/v1',
    kind: 'CSINode',
    metadata: {
      name: data.name,
      namespace: data.namespace,
    },
    spec: {
      drivers: data.drivers
        .filter((d) => d.name)
        .map((d) => ({
          name: d.name,
          nodeID: d.nodeID,
          topologyKeys: d.topologyKeys ? d.topologyKeys.split(',').map((k) => k.trim()).filter(Boolean) : [],
        })),
    },
  }
}

export function manifestToCSINodeForm(manifest: any): CSINodeFormData | null {
  try {
    return {
      name: manifest.metadata?.name || '',
      namespace: manifest.metadata?.namespace || 'default',
      drivers: (manifest.spec?.drivers || []).map((d: any) => ({
        name: d.name || '',
        nodeID: d.nodeID || '',
        topologyKeys: Array.isArray(d.topologyKeys) ? d.topologyKeys.join(', ') : String(d.topologyKeys || ''),
      })),
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
    case 'certificatesigningrequests':
      return certificateSigningRequestFormToManifest(data as CertificateSigningRequestFormData)
    case 'priorityclasses':
      return priorityClassFormToManifest(data as PriorityClassFormData)
    case 'leases':
      return leaseFormToManifest(data as LeaseFormData)
    case 'runtimeclasses':
      return runtimeClassFormToManifest(data as RuntimeClassFormData)
    case 'volumeattachments':
      return volumeAttachmentFormToManifest(data as VolumeAttachmentFormData)
    case 'csidrivers':
      return csiDriverFormToManifest(data as CSIDriverFormData)
    case 'csinodes':
      return csiNodeFormToManifest(data as CSINodeFormData)
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
    case 'certificatesigningrequests':
      return manifestToCertificateSigningRequestForm(manifest)
    case 'priorityclasses':
      return manifestToPriorityClassForm(manifest)
    case 'leases':
      return manifestToLeaseForm(manifest)
    case 'runtimeclasses':
      return manifestToRuntimeClassForm(manifest)
    case 'volumeattachments':
      return manifestToVolumeAttachmentForm(manifest)
    case 'csidrivers':
      return manifestToCSIDriverForm(manifest)
    case 'csinodes':
      return manifestToCSINodeForm(manifest)
    default:
      return null
  }
}

// 是否支持表单模式
export function supportsFormMode(kind: string): boolean {
  return [
    'deployments', 'services', 'configmaps', 'secrets', 'pods',
    'horizontalpodautoscalers', 'networkpolicies', 'poddisruptionbudgets',
    'endpointslices', 'replicationcontrollers', 'limitranges', 'resourcequotas',
    'certificatesigningrequests', 'priorityclasses', 'leases',
    'runtimeclasses', 'volumeattachments', 'csidrivers', 'csinodes',
  ].includes(kind)
}
