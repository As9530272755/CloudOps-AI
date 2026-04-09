import { useState, useEffect } from 'react'
import { useProfile } from '../lib/api'

export function useAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [loading, setLoading] = useState(true)
  const { data: user, isLoading, error } = useProfile()

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    
    if (!token) {
      setIsAuthenticated(false)
      setLoading(false)
      return
    }

    if (isLoading) {
      setLoading(true)
      return
    }

    if (error) {
      setIsAuthenticated(false)
      setLoading(false)
      return
    }

    if (user) {
      setIsAuthenticated(true)
      setLoading(false)
    }
  }, [user, isLoading, error])

  return {
    isAuthenticated,
    loading,
    user,
  }
}