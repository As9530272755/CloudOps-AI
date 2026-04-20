import { Box, Typography, TextField, Divider, Chip } from '@mui/material'
import { FormComponentProps, CertificateSigningRequestFormData } from './index'

const defaultData: CertificateSigningRequestFormData = {
  name: '',
  namespace: 'default',
  signerName: 'kubernetes.io/kube-apiserver-client',
  request: '',
  usages: ['client auth'],
}

export { defaultData as certificateSigningRequestDefaultData }

export function CertificateSigningRequestForm({ data, onChange, namespaceReadOnly }: FormComponentProps<CertificateSigningRequestFormData>) {
  const d = { ...defaultData, ...data }

  const update = (patch: Partial<CertificateSigningRequestFormData>) => {
    onChange({ ...d, ...patch })
  }

  const usageOptions = ['client auth', 'server auth', 'code signing', 'email protection', 'time stamping', 'cert sign', 'crl sign', 'ocsp signing', 'any', 'digital signature', 'key encipherment', 'content commitment', 'data encipherment', 'key agreement']

  const toggleUsage = (usage: string) => {
    const usages = d.usages.includes(usage)
      ? d.usages.filter((u) => u !== usage)
      : [...d.usages, usage]
    update({ usages })
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* 基本信息 */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary' }}>
          基本信息
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            label="名称"
            size="small"
            value={d.name}
            onChange={(e) => update({ name: e.target.value })}
            helperText="只能包含小写字母、数字和连字符(-)"
            sx={{ minWidth: 240, flex: 1 }}
          />
          <TextField
            label="命名空间"
            size="small"
            value={d.namespace}
            disabled={namespaceReadOnly}
            onChange={(e) => update({ namespace: e.target.value })}
            sx={{ minWidth: 200, flex: 1 }}
          />
        </Box>
      </Box>

      <Divider />

      {/* 签名者 */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary' }}>
          签名者
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            label="Signer Name"
            size="small"
            value={d.signerName}
            onChange={(e) => update({ signerName: e.target.value })}
            placeholder="例如: kubernetes.io/kube-apiserver-client"
            sx={{ minWidth: 300, flex: 1 }}
          />
        </Box>
      </Box>

      <Divider />

      {/* CSR 请求 */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary' }}>
          CSR 请求 (Base64 编码)
        </Typography>
        <TextField
          size="small"
          multiline
          rows={4}
          value={d.request}
          onChange={(e) => update({ request: e.target.value })}
          placeholder="输入 base64 编码的 CSR PEM"
          fullWidth
        />
      </Box>

      <Divider />

      {/* 用途 */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary' }}>
          用途 (usages)
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {usageOptions.map((usage) => (
            <Chip
              key={usage}
              label={usage}
              color={d.usages.includes(usage) ? 'primary' : 'default'}
              onClick={() => toggleUsage(usage)}
              sx={{ cursor: 'pointer' }}
            />
          ))}
        </Box>
      </Box>
    </Box>
  )
}
