import { FormData } from '../../lib/yaml-helpers'

export * from '../../lib/yaml-helpers'

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
]

export function isFormSupported(kind: string): boolean {
  return supportedFormKinds.includes(kind)
}
