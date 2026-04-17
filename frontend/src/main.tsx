import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { CssBaseline } from '@mui/material'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LocalizationProvider } from '@mui/x-date-pickers'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import 'dayjs/locale/zh-cn'
import App from './App'
import { ColorModeProvider } from './context/ColorModeContext'
import { SiteConfigProvider } from './context/SiteConfigContext'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ColorModeProvider>
          <SiteConfigProvider>
            <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="zh-cn">
              <CssBaseline />
              <App />
            </LocalizationProvider>
          </SiteConfigProvider>
        </ColorModeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
