import { createTheme, ThemeOptions } from '@mui/material/styles'

// 主题配置
const themeOptions: ThemeOptions = {
  palette: {
    mode: 'light',
    primary: {
      main: '#0066CC',
      light: '#3388DD',
      dark: '#004499',
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: '#6B2FA0',
      light: '#8B4FC0',
      dark: '#4B0F80',
      contrastText: '#FFFFFF',
    },
    background: {
      default: '#F5F7FA',
      paper: '#FFFFFF',
    },
    text: {
      primary: '#1A2332',
      secondary: '#5A6A7A',
    },
    success: {
      main: '#10B981',
      light: '#34D399',
      dark: '#059669',
    },
    warning: {
      main: '#F59E0B',
      light: '#FBBF24',
      dark: '#D97706',
    },
    error: {
      main: '#EF4444',
      light: '#F87171',
      dark: '#DC2626',
    },
    info: {
      main: '#3B82F6',
      light: '#60A5FA',
      dark: '#2563EB',
    },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h1: {
      fontSize: '2.5rem',
      fontWeight: 600,
    },
    h2: {
      fontSize: '2rem',
      fontWeight: 600,
    },
    h3: {
      fontSize: '1.75rem',
      fontWeight: 600,
    },
    h4: {
      fontSize: '1.5rem',
      fontWeight: 600,
    },
    h5: {
      fontSize: '1.25rem',
      fontWeight: 600,
    },
    h6: {
      fontSize: '1rem',
      fontWeight: 600,
    },
  },
  shape: {
    borderRadius: 8,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 500,
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#FFFFFF',
          color: '#1A2332',
        },
      },
    },
  },
}

// 创建浅色主题
export const lightTheme = createTheme(themeOptions)

// 创建深色主题
export const darkTheme = createTheme({
  ...themeOptions,
  palette: {
    ...themeOptions.palette!,
    mode: 'dark',
    primary: {
      main: '#00D4FF',
      light: '#33E0FF',
      dark: '#00A0CC',
      contrastText: '#0F172A',
    },
    secondary: {
      main: '#A855F7',
      light: '#C084FC',
      dark: '#7C3AED',
      contrastText: '#FFFFFF',
    },
    background: {
      default: '#0F172A',
      paper: '#1E293B',
    },
    text: {
      primary: '#F1F5F9',
      secondary: '#94A3B8',
    },
  },
})

// 默认导出浅色主题
export const theme = lightTheme