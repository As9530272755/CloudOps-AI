import { FormData } from '../../lib/yaml-helpers'

export * from '../../lib/yaml-helpers'

export * from './DeploymentForm'
export * from './ServiceForm'
export * from './ConfigMapForm'
export * from './SecretForm'
export * from './PodForm'
export * from './HorizontalPodAutoscalerForm'
export * from './IngressForm'
export * from './NetworkPolicyForm'
export * from './PodDisruptionBudgetForm'
export * from './EndpointSliceForm'
export * from './ReplicationControllerForm'
export * from './LimitRangeForm'
export * from './ResourceQuotaForm'
export * from './LeaseForm'
export * from './StatefulSetForm'
export * from './DaemonSetForm'
export * from './ReplicaSetForm'
export * from './JobForm'
export * from './CronJobForm'
export * from './EndpointForm'
export * from './PersistentVolumeForm'
export * from './PersistentVolumeClaimForm'
export * from './StorageClassForm'
export * from './ServiceAccountForm'
export * from './RoleForm'
export * from './RoleBindingForm'
export * from './ClusterRoleForm'
export * from './ClusterRoleBindingForm'
export * from './NamespaceForm'
export * from './NodeForm'
export * from './EventForm'
export * from './CustomResourceDefinitionForm'

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
  'ingresses',
  'networkpolicies',
  'poddisruptionbudgets',
  'endpointslices',
  'replicationcontrollers',
  'limitranges',
  'resourcequotas',
  'leases',
  'statefulsets',
  'daemonsets',
  'replicasets',
  'jobs',
  'cronjobs',
  'endpoints',
  'persistentvolumes',
  'persistentvolumeclaims',
  'storageclasses',
  'serviceaccounts',
  'roles',
  'rolebindings',
  'clusterroles',
  'clusterrolebindings',
  'namespaces',
  'nodes',
  'events',
  'customresourcedefinitions',
]

export function isFormSupported(kind: string): boolean {
  return supportedFormKinds.includes(kind)
}
