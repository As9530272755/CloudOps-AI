import { Box, Typography, Card, CardContent } from '@mui/material'
import { glassEffect } from '../theme/theme'

export default function Users() {
  return (
    <Box sx={{ p: 3 }}>
      <Card sx={{ ...glassEffect }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h5" fontWeight={600} gutterBottom>
            用户管理
          </Typography>
          <Typography variant="body2" color="text.secondary">
            功能开发中，敬请期待...
          </Typography>
        </CardContent>
      </Card>
    </Box>
  )
}