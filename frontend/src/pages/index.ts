export { default as Dashboard } from './Dashboard'
export { default as Login } from './Login'

// 占位组件
function PlaceholderPage({ title }: { title: string }) {
  return (
    <div style={{ padding: '24px' }}>
      <h2>{title}</h2>
      <p style={{ color: '#666' }}>功能开发中...</p>
    </div>
  )
}

export const Clusters = () => <PlaceholderPage title="集群管理" />
export const Inspection = () => <PlaceholderPage title="巡检中心" />
export const Data = () => <PlaceholderPage title="数据管理" />
export const Logs = () => <PlaceholderPage title="日志管理" />
export const AI = () => <PlaceholderPage title="AI助手" />
export const Terminal = () => <PlaceholderPage title="Web终端" />
export const Users = () => <PlaceholderPage title="用户管理" />
export const Tenants = () => <PlaceholderPage title="租户管理" />
export const Settings = () => <PlaceholderPage title="系统设置" />