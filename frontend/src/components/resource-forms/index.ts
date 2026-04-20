import { FormData } from '../../lib/yaml-helpers'

export * from '../../lib/yaml-helpers'

export * from './HorizontalPodAutoscalerForm'
export * from './NetworkPolicyForm'
export * from './PodDisruptionBudgetForm'
export * from './EndpointSliceForm'
export * from './ReplicationControllerForm'
export * from './LimitRangeForm'
export * from './ResourceQuotaForm'
export * from './CertificateSigningRequestForm'
export * from './PriorityClassForm'
export * from './LeaseForm'
export * from './RuntimeClassForm'
export * from './VolumeAttachmentForm'
export * from './CSIDriverForm'
export * from './CSINodeForm'

// 表单组件类型
export type FormComponentProps<T extends FormData = FormData> = {
  data: T
  onChange: (data: T) => void
  namespaceReadOnly?: boolean
}

// 支持的表单资源类型
export const supportedFormKinds = [
  'deployments',
  'services',
  'configmaps',
  'secrets',
  'pods',
  'horizontalpodautoscalers',
  'networkpolicies',
  'poddisruptionbudgets',
  'endpointslices',
  'replicationcontrollers',
  'limitranges',
  'resourcequotas',
  'certificatesigningrequests',
  'priorityclasses',
  'leases',
  'runtimeclasses',
  'volumeattachments',
  'csidrivers',
  'csinodes',
]

export function isFormSupported(kind: string): boolean {
  return supportedFormKinds.includes(kind)
}
