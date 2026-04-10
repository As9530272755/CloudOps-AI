import { Box, Typography, Card, CardContent } from '@mui/material'


export default function Logs() {
  return (
    <Box sx={{ p: 3 }}>
      <Card sx={{ border: '1px solid', borderColor: 'divider' }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h5" fontWeight={600} gutterBottom>
            日志管理
          </Typography>
          <Typography variant="body2" color="text.secondary">
            功能开发中，敬请期待...
          </Typography>
        </CardContent>
      </Card>
    </Box>
  )
}