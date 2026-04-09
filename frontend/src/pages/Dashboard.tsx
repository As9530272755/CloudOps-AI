import { Box, Card, CardContent, Typography, Grid } from '@mui/material'
import {
  CloudQueue as ClusterIcon,
  Dns as NodeIcon,
  Widgets as PodIcon,
  CheckCircle as HealthyIcon,
} from '@mui/icons-material'

const stats = [
  { label: '集群数量', value: '3', icon: <ClusterIcon />, color: '#0066CC' },
  { label: '节点数量', value: '12', icon: <NodeIcon />, color: '#10B981' },
  { label: 'Pod 数量', value: '1,234', icon: <PodIcon />, color: '#F59E0B' },
  { label: '健康状态', value: '98%', icon: <HealthyIcon />, color: '#6B2FA0' },
]

export default function Dashboard() {
  return (
    <Box>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        仪表盘
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        欢迎使用 CloudOps 云原生运维管理平台
      </Typography>

      {/* 统计卡片 */}
      <Grid container spacing={3}>
        {stats.map((stat) => (
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Box>
                    <Typography color="text.secondary" variant="body2" gutterBottom>
                      {stat.label}
                    </Typography>
                    <Typography variant="h4" fontWeight={700}>
                      {stat.value}
                    </Typography>
                  </Box>
                  <Box
                    sx={{
                      width: 48,
                      height: 48,
                      borderRadius: 2,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      bgcolor: `${stat.color}15`,
                      color: stat.color,
                    }}
                  >
                    {stat.icon}
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* 欢迎信息 */}
      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            快速开始
          </Typography>
          <Typography variant="body2" color="text.secondary">
            CloudOps Platform 是一个基于 Kubernetes 的云原生运维管理平台。
            您可以通过左侧菜单访问集群管理、巡检中心、数据管理等功能。
          </Typography>
        </CardContent>
      </Card>
    </Box>
  )
}