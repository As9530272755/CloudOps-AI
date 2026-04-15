import { Box, Typography } from '@mui/material'

export default function Data() {
  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" fontWeight={600} gutterBottom>
          数据管理
        </Typography>
        <Typography variant="body2" color="text.secondary">
          功能开发中，敬请期待...
        </Typography>
      </Box>
    </Box>
  )
}
