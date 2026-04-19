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
