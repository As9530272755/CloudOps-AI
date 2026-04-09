import { createContext, useContext, useState, ReactNode } from 'react'
import { Cluster } from '../lib/cluster-api'

interface ClusterContextType {
  selectedCluster: Cluster | null
  setSelectedCluster: (cluster: Cluster | null) => void
}

const ClusterContext = createContext<ClusterContextType | undefined>(undefined)

export function ClusterProvider({ children }: { children: ReactNode }) {
  const [selectedCluster, setSelectedCluster] = useState<Cluster | null>(null)

  return (
    <ClusterContext.Provider value={{ selectedCluster, setSelectedCluster }}>
      {children}
    </ClusterContext.Provider>
  )
}

export function useCluster() {
  const context = useContext(ClusterContext)
  if (!context) {
    throw new Error('useCluster must be used within ClusterProvider')
  }
  return context
}
