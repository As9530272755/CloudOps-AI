import { useState, useEffect, useCallback } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Switch,
  FormControlLabel,
  Typography,
  Alert,
} from '@mui/material'
import Editor from '@monaco-editor/react'
import {
  supportsFormMode,
  generateManifest,
  parseManifest,
  manifestToYaml,
  yamlToManifest,
  FormData,
} from '../lib/yaml-helpers'
import { DeploymentForm, deploymentDefaultData } from './resource-forms/DeploymentForm'
import { ServiceForm, serviceDefaultData } from './resource-forms/ServiceForm'
import { ConfigMapForm, configMapDefaultData } from './resource-forms/ConfigMapForm'
import { SecretForm, secretDefaultData } from './resource-forms/SecretForm'
import { PodForm, podDefaultData } from './resource-forms/PodForm'
import { HorizontalPodAutoscalerForm, horizontalPodAutoscalerDefaultData } from './resource-forms/HorizontalPodAutoscalerForm'
import { IngressForm, ingressDefaultData } from './resource-forms/IngressForm'
import { NetworkPolicyForm, networkPolicyDefaultData } from './resource-forms/NetworkPolicyForm'
import { PodDisruptionBudgetForm, podDisruptionBudgetDefaultData } from './resource-forms/PodDisruptionBudgetForm'
import { EndpointSliceForm, endpointSliceDefaultData } from './resource-forms/EndpointSliceForm'
import { ReplicationControllerForm, replicationControllerDefaultData } from './resource-forms/ReplicationControllerForm'
import { LimitRangeForm, limitRangeDefaultData } from './resource-forms/LimitRangeForm'
import { ResourceQuotaForm, resourceQuotaDefaultData } from './resource-forms/ResourceQuotaForm'
import { LeaseForm, leaseDefaultData } from './resource-forms/LeaseForm'
import { StatefulSetForm, statefulSetDefaultData } from './resource-forms/StatefulSetForm'
import { DaemonSetForm, daemonSetDefaultData } from './resource-forms/DaemonSetForm'
import { ReplicaSetForm, replicaSetDefaultData } from './resource-forms/ReplicaSetForm'
import { JobForm, jobDefaultData } from './resource-forms/JobForm'
import { CronJobForm, cronJobDefaultData } from './resource-forms/CronJobForm'
import { EndpointForm, endpointDefaultData } from './resource-forms/EndpointForm'
import { PersistentVolumeForm, persistentVolumeDefaultData } from './resource-forms/PersistentVolumeForm'
import { PersistentVolumeClaimForm, persistentVolumeClaimDefaultData } from './resource-forms/PersistentVolumeClaimForm'
import { StorageClassForm, storageClassDefaultData } from './resource-forms/StorageClassForm'
import { ServiceAccountForm, serviceAccountDefaultData } from './resource-forms/ServiceAccountForm'
import { RoleForm, roleDefaultData } from './resource-forms/RoleForm'
import { RoleBindingForm, roleBindingDefaultData } from './resource-forms/RoleBindingForm'
import { ClusterRoleForm, clusterRoleDefaultData } from './resource-forms/ClusterRoleForm'
import { ClusterRoleBindingForm, clusterRoleBindingDefaultData } from './resource-forms/ClusterRoleBindingForm'
import { NamespaceForm, namespaceDefaultData } from './resource-forms/NamespaceForm'
import { NodeForm, nodeDefaultData } from './resource-forms/NodeForm'
import { EventForm, eventDefaultData } from './resource-forms/EventForm'
import { CustomResourceDefinitionForm, customResourceDefinitionDefaultData } from './resource-forms/CustomResourceDefinitionForm'

interface ResourceEditorDialogProps {
  open: boolean
  onClose: () => void
  kind: string
  namespace: string
  clusterId: number
  mode: 'create' | 'edit'
  initialYaml?: string
  onSubmit: (manifest: any) => void
}

function getDefaultFormData(kind: string, namespace: string): FormData {
  const base = { namespace }
  switch (kind) {
    case 'deployments':
      return { ...deploymentDefaultData, ...base }
    case 'services':
      return { ...serviceDefaultData, ...base }
    case 'configmaps':
      return { ...configMapDefaultData, ...base }
    case 'secrets':
      return { ...secretDefaultData, ...base }
    case 'pods':
      return { ...podDefaultData, ...base }
    case 'horizontalpodautoscalers':
      return { ...horizontalPodAutoscalerDefaultData, ...base }
    case 'ingresses':
      return { ...ingressDefaultData, ...base }
    case 'networkpolicies':
      return { ...networkPolicyDefaultData, ...base }
    case 'poddisruptionbudgets':
      return { ...podDisruptionBudgetDefaultData, ...base }
    case 'endpointslices':
      return { ...endpointSliceDefaultData, ...base }
    case 'replicationcontrollers':
      return { ...replicationControllerDefaultData, ...base }
    case 'limitranges':
      return { ...limitRangeDefaultData, ...base }
    case 'resourcequotas':
      return { ...resourceQuotaDefaultData, ...base }
    case 'leases':
      return { ...leaseDefaultData, ...base }
    case 'statefulsets':
      return { ...statefulSetDefaultData, ...base }
    case 'daemonsets':
      return { ...daemonSetDefaultData, ...base }
    case 'replicasets':
      return { ...replicaSetDefaultData, ...base }
    case 'jobs':
      return { ...jobDefaultData, ...base }
    case 'cronjobs':
      return { ...cronJobDefaultData, ...base }
    case 'endpoints':
      return { ...endpointDefaultData, ...base }
    case 'persistentvolumes':
      return { ...persistentVolumeDefaultData, ...base }
    case 'persistentvolumeclaims':
      return { ...persistentVolumeClaimDefaultData, ...base }
    case 'storageclasses':
      return { ...storageClassDefaultData, ...base }
    case 'serviceaccounts':
      return { ...serviceAccountDefaultData, ...base }
    case 'roles':
      return { ...roleDefaultData, ...base }
    case 'rolebindings':
      return { ...roleBindingDefaultData, ...base }
    case 'clusterroles':
      return { ...clusterRoleDefaultData, ...base }
    case 'clusterrolebindings':
      return { ...clusterRoleBindingDefaultData, ...base }
    case 'namespaces':
      return { ...namespaceDefaultData, ...base }
    case 'nodes':
      return { ...nodeDefaultData }
    case 'events':
      return { ...eventDefaultData, ...base }
    case 'customresourcedefinitions':
      return { ...customResourceDefinitionDefaultData }
    default:
      return { name: '', namespace }
  }
}

function renderForm(
  kind: string,
  data: FormData,
  onChange: (data: FormData) => void,
  namespaceReadOnly: boolean
) {
  switch (kind) {
    case 'deployments':
      return <DeploymentForm data={data as any} onChange={onChange} namespaceReadOnly={namespaceReadOnly} />
    case 'services':
      return <ServiceForm data={data as any} onChange={onChange} namespaceReadOnly={namespaceReadOnly} />
    case 'configmaps':
      return <ConfigMapForm data={data as any} onChange={onChange} namespaceReadOnly={namespaceReadOnly} />
    case 'secrets':
      return <SecretForm data={data as any} onChange={onChange} namespaceReadOnly={namespaceReadOnly} />
    case 'pods':
      return <PodForm data={data as any} onChange={onChange} namespaceReadOnly={namespaceReadOnly} />
    case 'horizontalpodautoscalers':
      return <HorizontalPodAutoscalerForm data={data as any} onChange={onChange} namespaceReadOnly={namespaceReadOnly} />
    case 'ingresses':
      return <IngressForm data={data as any} onChange={onChange} namespaceReadOnly={namespaceReadOnly} />
    case 'networkpolicies':
      return <NetworkPolicyForm data={data as any} onChange={onChange} namespaceReadOnly={namespaceReadOnly} />
    case 'poddisruptionbudgets':
      return <PodDisruptionBudgetForm data={data as any} onChange={onChange} namespaceReadOnly={namespaceReadOnly} />
    case 'endpointslices':
      return <EndpointSliceForm data={data as any} onChange={onChange} namespaceReadOnly={namespaceReadOnly} />
    case 'replicationcontrollers':
      return <ReplicationControllerForm data={data as any} onChange={onChange} namespaceReadOnly={namespaceReadOnly} />
    case 'limitranges':
      return <LimitRangeForm data={data as any} onChange={onChange} namespaceReadOnly={namespaceReadOnly} />
    case 'resourcequotas':
      return <ResourceQuotaForm data={data as any} onChange={onChange} namespaceReadOnly={namespaceReadOnly} />
    case 'leases':
      return <LeaseForm data={data as any} onChange={onChange} namespaceReadOnly={namespaceReadOnly} />
    case 'statefulsets':
      return <StatefulSetForm data={data as any} onChange={onChange} namespaceReadOnly={namespaceReadOnly} />
    case 'daemonsets':
      return <DaemonSetForm data={data as any} onChange={onChange} namespaceReadOnly={namespaceReadOnly} />
    case 'replicasets':
      return <ReplicaSetForm data={data as any} onChange={onChange} namespaceReadOnly={namespaceReadOnly} />
    case 'jobs':
      return <JobForm data={data as any} onChange={onChange} namespaceReadOnly={namespaceReadOnly} />
    case 'cronjobs':
      return <CronJobForm data={data as any} onChange={onChange} namespaceReadOnly={namespaceReadOnly} />
    case 'endpoints':
      return <EndpointForm data={data as any} onChange={onChange} namespaceReadOnly={namespaceReadOnly} />
    case 'persistentvolumes':
      return <PersistentVolumeForm data={data as any} onChange={onChange} namespaceReadOnly={namespaceReadOnly} />
    case 'persistentvolumeclaims':
      return <PersistentVolumeClaimForm data={data as any} onChange={onChange} namespaceReadOnly={namespaceReadOnly} />
    case 'storageclasses':
      return <StorageClassForm data={data as any} onChange={onChange} />
    case 'serviceaccounts':
      return <ServiceAccountForm data={data as any} onChange={onChange} namespaceReadOnly={namespaceReadOnly} />
    case 'roles':
      return <RoleForm data={data as any} onChange={onChange} namespaceReadOnly={namespaceReadOnly} />
    case 'rolebindings':
      return <RoleBindingForm data={data as any} onChange={onChange} namespaceReadOnly={namespaceReadOnly} />
    case 'clusterroles':
      return <ClusterRoleForm data={data as any} onChange={onChange} />
    case 'clusterrolebindings':
      return <ClusterRoleBindingForm data={data as any} onChange={onChange} />
    case 'namespaces':
      return <NamespaceForm data={data as any} onChange={onChange} />
    case 'nodes':
      return <NodeForm data={data as any} onChange={onChange} />
    case 'events':
      return <EventForm data={data as any} onChange={onChange} namespaceReadOnly={namespaceReadOnly} />
    case 'customresourcedefinitions':
      return <CustomResourceDefinitionForm data={data as any} onChange={onChange} />
    default:
      return null
  }
}

export default function ResourceEditorDialog({
  open,
  onClose,
  kind,
  namespace,
  mode,
  initialYaml,
  onSubmit,
}: ResourceEditorDialogProps) {
  const [yamlMode, setYamlMode] = useState(false)
  const [formData, setFormData] = useState<FormData>(getDefaultFormData(kind, namespace))
  const [yamlText, setYamlText] = useState('')
  const [error, setError] = useState('')

  const supported = supportsFormMode(kind)

  // 初始化
  useEffect(() => {
    if (!open) return
    setError('')

    if (mode === 'edit' && initialYaml) {
      setYamlText(initialYaml)
      if (supported) {
        try {
          const manifest = yamlToManifest(initialYaml)
          const parsed = parseManifest(kind, manifest)
          if (parsed) {
            setFormData(parsed)
            setYamlMode(false)
          } else {
            setYamlMode(true)
          }
        } catch {
          setYamlMode(true)
        }
      } else {
        setYamlMode(true)
      }
    } else {
      // 创建模式
      const defaultData = getDefaultFormData(kind, namespace)
      setFormData(defaultData)
      if (supported) {
        setYamlMode(false)
        try {
          const manifest = generateManifest(kind, defaultData)
          setYamlText(manifestToYaml(manifest))
        } catch {
          setYamlText('')
        }
      } else {
        setYamlMode(true)
        setYamlText('')
      }
    }
  }, [open, kind, namespace, mode, initialYaml, supported])

  // 表单变化时同步更新 YAML
  useEffect(() => {
    if (!supported || yamlMode) return
    try {
      const manifest = generateManifest(kind, formData)
      setYamlText(manifestToYaml(manifest))
      setError('')
    } catch (err: any) {
      setError(err.message || '表单转 YAML 失败')
    }
  }, [formData, kind, supported, yamlMode])

  // YAML 变化时尝试同步表单（可选，简化设计：只在切换到表单模式时解析）
  const handleSwitchToForm = useCallback(() => {
    if (!supported) {
      setYamlMode(false)
      return
    }
    try {
      const manifest = yamlToManifest(yamlText)
      const parsed = parseManifest(kind, manifest)
      if (parsed) {
        setFormData(parsed)
        setYamlMode(false)
        setError('')
      } else {
        setError('无法从当前 YAML 解析为表单，请检查 YAML 格式或继续使用 YAML 模式')
      }
    } catch (err: any) {
      setError(`YAML 解析失败: ${err.message}`)
    }
  }, [yamlText, kind, supported])

  const handleSwitchToYaml = useCallback(() => {
    if (supported) {
      try {
        const manifest = generateManifest(kind, formData)
        setYamlText(manifestToYaml(manifest))
      } catch (err: any) {
        setError(err.message || '表单转 YAML 失败')
        return
      }
    }
    setYamlMode(true)
    setError('')
  }, [formData, kind, supported])

  const handleSubmit = () => {
    setError('')
    try {
      let manifest: any
      if (yamlMode) {
        manifest = yamlToManifest(yamlText)
        if (!manifest || typeof manifest !== 'object') {
          setError('YAML 内容无效')
          return
        }
      } else {
        manifest = generateManifest(kind, formData)
      }

      // 基本校验
      if (!manifest.metadata?.name) {
        setError('资源名称不能为空')
        return
      }

      onSubmit(manifest)
    } catch (err: any) {
      setError(err.message || '提交失败')
    }
  }

  const resourceLabel = kind.replace(/s$/, '').replace(/es$/, 'e')

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle
        sx={{
          fontWeight: 600,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          pr: 2,
        }}
      >
        <span>
          {mode === 'create' ? '创建' : '编辑'} {resourceLabel}
        </span>
        {supported && (
          <FormControlLabel
            control={
              <Switch
                checked={yamlMode}
                onChange={(e) => {
                  if (e.target.checked) {
                    handleSwitchToYaml()
                  } else {
                    handleSwitchToForm()
                  }
                }}
              />
            }
            label={
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                编辑 YAML
              </Typography>
            }
          />
        )}
      </DialogTitle>

      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {yamlMode ? (
          <Box sx={{ borderRadius: 2, overflow: 'hidden', border: '1px solid rgba(0,0,0,0.08)' }}>
            <Editor
              height="60vh"
              language="yaml"
              value={yamlText}
              theme="vs-dark"
              onChange={(v) => setYamlText(v || '')}
              options={{
                minimap: { enabled: false },
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                fontSize: 13,
                wordWrap: 'on',
                automaticLayout: true,
              }}
            />
          </Box>
        ) : supported ? (
          <Box sx={{ py: 1 }}>
            {renderForm(kind, formData, setFormData, namespace !== 'default' && namespace !== '')}
          </Box>
        ) : (
          <Alert severity="info" sx={{ my: 2 }}>
            该资源类型暂不支持表单模式，请使用 YAML 模式编辑。
          </Alert>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>
          取消
        </Button>
        <Button variant="contained" onClick={handleSubmit} sx={{ textTransform: 'none' }}>
          {mode === 'create' ? '创建' : '保存'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
