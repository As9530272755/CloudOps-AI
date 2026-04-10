import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { ThemeProvider } from '@mui/material'
import { lightTheme, darkTheme } from '../theme/theme'

type ColorMode = 'light' | 'dark'

interface ColorModeContextValue {
  mode: ColorMode
  toggleColorMode: () => void
  setColorMode: (mode: ColorMode) => void
}

const ColorModeContext = createContext<ColorModeContextValue>({
  mode: 'light',
  toggleColorMode: () => {},
  setColorMode: () => {},
})

export const useColorMode = () => useContext(ColorModeContext)

export function ColorModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ColorMode>(() => {
    if (typeof window === 'undefined') return 'light'
    const stored = localStorage.getItem('cloudops-color-mode') as ColorMode | null
    if (stored === 'light' || stored === 'dark') return stored
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  useEffect(() => {
    localStorage.setItem('cloudops-color-mode', mode)
  }, [mode])

  const toggleColorMode = () => {
    setMode((prev) => (prev === 'light' ? 'dark' : 'light'))
  }

  const theme = useMemo(() => (mode === 'dark' ? darkTheme : lightTheme), [mode])

  const value = useMemo(
    () => ({ mode, toggleColorMode, setColorMode: setMode }),
    [mode]
  )

  return (
    <ColorModeContext.Provider value={value}>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </ColorModeContext.Provider>
  )
}
