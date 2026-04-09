import { Box, Card, CardContent, Typography } from '@mui/material'
import { glassEffect } from '../theme/theme'

export default function Dashboard() {
  return (
    <Box sx={{ p: 3 }}>
      <Card sx={{ ...glassEffect }}>
        <CardContent sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="h5" sx={{ fontWeight: 600, mb: 2 }}>
            仪表盘
          </Typography>
          <Typography variant="body1" sx={{ color: 'text.secondary', mb: 2 }}>
            数据待对接
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            请先前往"集群管理"添加 K8s 集群
          </Typography>
        </CardContent>
      </Card>
    </Box>
  )
}