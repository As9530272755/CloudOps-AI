import { Box, Card, CardContent, Typography, Grid, Avatar, alpha, LinearProgress } from '@mui/material'
import {
  CloudQueue as ClusterIcon,
  Dns as NodeIcon,
  Widgets as PodIcon,
  CheckCircle as HealthyIcon,
  TrendingUp as TrendingUpIcon,
  Speed as SpeedIcon,
} from '@mui/icons-material'
import { glassEffect } from '../theme/theme'

// 统计数据
const stats = [
  { 
    label: '集群数量', 
    value: '3', 
    icon: <ClusterIcon />, 
    color: '#007AFF',
    trend: '+1',
    trendUp: true,
  },
  { 
    label: '节点数量', 
    value: '12', 
    icon: <NodeIcon />, 
    color: '#34C759',
    trend: '+2',
    trendUp: true,
  },
  { 
    label: 'Pod 数量', 
    value: '1,234', 
    icon: <PodIcon />, 
    color: '#FF9500',
    trend: '+56',
    trendUp: true,
  },
  { 
    label: '健康率', 
    value: '98%', 
    icon: <HealthyIcon />, 
    color: '#5856D6',
    trend: '+2%',
    trendUp: true,
  },
]

// 最近活动
const recentActivities = [
  { title: '集群 production-cluster 健康检查通过', time: '5 分钟前', type: 'success' },
  { title: 'Pod nginx-deployment 扩容至 3 副本', time: '15 分钟前', type: 'info' },
  { title: '节点 node-1 CPU 使用率超过 80%', time: '1 小时前', type: 'warning' },
  { title: '巡检任务 "每日巡检" 已完成', time: '2 小时前', type: 'success' },
]

// 资源使用
const resourceUsage = [
  { name: 'CPU 使用率', value: 65, color: '#007AFF' },
  { name: '内存使用率', value: 78, color: '#5856D6' },
  { name: '存储使用率', value: 45, color: '#34C759' },
  { name: '网络带宽', value: 32, color: '#FF9500' },
]

export default function Dashboard() {
  return (
    <Box>
      {/* 页面标题 */}
      <Box sx={{ mb: 4 }}>
        <Typography
          variant="h4"
          sx={{
            fontWeight: 700,
            mb: 1,
            background: 'linear-gradient(135deg, #1D2939 0%, #475467 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          仪表盘
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          欢迎使用 CloudOps 云原生运维管理平台
        </Typography>
      </Box>

      {/* 统计卡片 */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        {stats.map((stat, index) => (
          <Grid key={index} size={{ xs: 12, sm: 6, md: 3 }}>
            <Card
              sx={{
                ...glassEffect,
                height: '100%',
                transition: 'all 0.3s ease',
                '&:hover': {
                  transform: 'translateY(-4px)',
                  boxShadow: '0 12px 40px rgba(0, 0, 0, 0.12)',
                },
              }}
            >
              <CardContent sx={{ p: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <Box>
                    <Typography
                      variant="body2"
                      sx={{
                        color: 'text.secondary',
                        mb: 1,
                        fontWeight: 500,
                      }}
                    >
                      {stat.label}
                    </Typography>
                    <Typography
                      variant="h3"
                      sx={{
                        fontWeight: 700,
                        mb: 0.5,
                        color: 'text.primary',
                      }}
                    >
                      {stat.value}
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.5,
                        color: stat.trendUp ? 'success.main' : 'error.main',
                        fontWeight: 500,
                      }}
                    >
                      <TrendingUpIcon sx={{ fontSize: 14 }} />
                      {stat.trend}
                    </Typography>
                  </Box>
                  <Avatar
                    sx={{
                      width: 56,
                      height: 56,
                      bgcolor: alpha(stat.color, 0.1),
                      color: stat.color,
                      borderRadius: '16px',
                    }}
                  >
                    {stat.icon}
                  </Avatar>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={3}>
        {/* 资源使用 */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ ...glassEffect, height: '100%' }}>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 3 }}>
                资源使用
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {resourceUsage.map((resource, index) => (
                  <Box key={index}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {resource.name}
                      </Typography>
                      <Typography
                        variant="body2"
                        sx={{ fontWeight: 600, color: resource.color }}
                      >
                        {resource.value}%
                      </Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={resource.value}
                      sx={{
                        height: 8,
                        borderRadius: 4,
                        bgcolor: alpha(resource.color, 0.1),
                        '& .MuiLinearProgress-bar': {
                          borderRadius: 4,
                          background: `linear-gradient(90deg, ${resource.color} 0%, ${alpha(resource.color, 0.7)} 100%)`,
                        },
                      }}
                    />
                  </Box>
                ))}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* 最近活动 */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ ...glassEffect, height: '100%' }}>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 3 }}>
                最近活动
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {recentActivities.map((activity, index) => (
                  <Box
                    key={index}
                    sx={{
                      p: 2,
                      borderRadius: '12px',
                      bgcolor: (theme) => alpha(
                        activity.type === 'success'
                          ? theme.palette.success.main
                          : activity.type === 'warning'
                          ? theme.palette.warning.main
                          : theme.palette.primary.main,
                        0.05
                      ),
                      border: (theme) => `1px solid ${alpha(
                        activity.type === 'success'
                          ? theme.palette.success.main
                          : activity.type === 'warning'
                          ? theme.palette.warning.main
                          : theme.palette.primary.main,
                        0.1
                      )}`,
                    }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 500, mb: 0.5 }}>
                      {activity.title}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {activity.time}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* 快速操作 */}
      <Card sx={{ ...glassEffect, mt: 3 }}>
        <CardContent sx={{ p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
            快速开始
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            CloudOps Platform 是一个基于 Kubernetes 的云原生运维管理平台。
            您可以通过左侧菜单访问集群管理、巡检中心、数据管理等功能。
          </Typography>
        </CardContent>
      </Card>
    </Box>
  )
}