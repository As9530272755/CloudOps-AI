import { createTheme } from '@mui/material/styles'

// ==================== 颜色配置 ====================
const colors = {
  primary: {
    main: '#007AFF',
    light: '#5AC8FA',
    dark: '#0051D5',
    gradient: 'linear-gradient(135deg, #007AFF 0%, #5AC8FA 100%)',
  },
  secondary: {
    main: '#5856D6',
    light: '#AF52DE',
    dark: '#3634A3',
    gradient: 'linear-gradient(135deg, #5856D6 0%, #AF52DE 100%)',
  },
  success: {
    main: '#34C759',
    light: '#30D158',
    dark: '#248A3D',
  },
  warning: {
    main: '#FF9500',
    light: '#FFCC00',
    dark: '#C93400',
  },
  error: {
    main: '#FF3B30',
    light: '#FF453A',
    dark: '#D70015',
  },
  grey: {
    50: '#F9FAFB',
    100: '#F2F4F7',
    200: '#E4E7EC',
    300: '#D0D5DD',
    400: '#98A2B3',
    500: '#667085',
    600: '#475467',
    700: '#344054',
    800: '#1D2939',
    900: '#101828',
  },
}

// ==================== 磨玻璃效果 ====================
export const glassEffect = {
  background: 'rgba(255, 255, 255, 0.7)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  border: '1px solid rgba(255, 255, 255, 0.3)',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.08)',
}

export const glassEffectDark = {
  background: 'rgba(30, 41, 59, 0.7)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
}

// ==================== iOS 风格按钮 ====================
export const iOSButtonStyle = {
  borderRadius: '12px',
  padding: '12px 24px',
  fontSize: '15px',
  fontWeight: 500,
  textTransform: 'none',
  boxShadow: '0 2px 8px rgba(0, 122, 255, 0.25)',
  transition: 'all 0.2s ease-in-out',
  '&:hover': {
    transform: 'translateY(-1px)',
    boxShadow: '0 4px 12px rgba(0, 122, 255, 0.35)',
  },
  '&:active': {
    transform: 'translateY(0)',
  },
}

// ==================== iOS 风格卡片 ====================
export const iOSCardStyle = {
  borderRadius: '16px',
  border: '1px solid rgba(0, 0, 0, 0.04)',
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
  transition: 'all 0.3s ease',
  '&:hover': {
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.08)',
    transform: 'translateY(-2px)',
  },
}

// ==================== 浅色主题 ====================
export const lightTheme = createTheme({
  palette: {
    mode: 'light',
    primary: colors.primary,
    secondary: colors.secondary,
    success: colors.success,
    warning: colors.warning,
    error: colors.error,
    background: {
      default: '#F5F7FA',
      paper: '#FFFFFF',
    },
    text: {
      primary: colors.grey[900],
      secondary: colors.grey[600],
    },
    divider: 'rgba(0, 0, 0, 0.06)',
  },
  typography: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif',
    h1: {
      fontSize: '2.5rem',
      fontWeight: 700,
      letterSpacing: '-0.02em',
    },
    h2: {
      fontSize: '2rem',
      fontWeight: 700,
      letterSpacing: '-0.02em',
    },
    h3: {
      fontSize: '1.5rem',
      fontWeight: 600,
      letterSpacing: '-0.01em',
    },
    h4: {
      fontSize: '1.25rem',
      fontWeight: 600,
    },
    h5: {
      fontSize: '1.125rem',
      fontWeight: 600,
    },
    h6: {
      fontSize: '1rem',
      fontWeight: 600,
    },
    body1: {
      fontSize: '0.9375rem',
      lineHeight: 1.6,
    },
    body2: {
      fontSize: '0.875rem',
      lineHeight: 1.5,
    },
    button: {
      fontWeight: 500,
      letterSpacing: '0.02em',
    },
  },
  shape: {
    borderRadius: 12,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: '#F5F7FA',
          backgroundImage: `
            radial-gradient(circle at 20% 20%, rgba(0, 122, 255, 0.03) 0%, transparent 50%),
            radial-gradient(circle at 80% 80%, rgba(88, 86, 214, 0.03) 0%, transparent 50%)
          `,
          backgroundAttachment: 'fixed',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: iOSButtonStyle,
        containedPrimary: {
          background: colors.primary.gradient,
          '&:hover': {
            background: colors.primary.gradient,
          },
        },
        containedSecondary: {
          background: colors.secondary.gradient,
          '&:hover': {
            background: colors.secondary.gradient,
          },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: iOSCardStyle,
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: '16px',
          backgroundImage: 'none',
        },
        elevation1: {
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
        },
        elevation2: {
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)',
        },
        elevation3: {
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: '12px',
            backgroundColor: 'rgba(255, 255, 255, 0.8)',
            '&:hover': {
              backgroundColor: 'rgba(255, 255, 255, 0.95)',
            },
            '&.Mui-focused': {
              backgroundColor: '#FFFFFF',
              boxShadow: '0 0 0 3px rgba(0, 122, 255, 0.15)',
            },
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: '8px',
          fontWeight: 500,
        },
      },
    },
    MuiListItemIcon: {
      styleOverrides: {
        root: {
          minWidth: '40px',
        },
      },
    },
  },
})

// ==================== 深色主题 ====================
export const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      ...colors.primary,
      main: '#0A84FF',
    },
    secondary: {
      ...colors.secondary,
      main: '#5E5CE6',
    },
    success: colors.success,
    warning: colors.warning,
    error: colors.error,
    background: {
      default: '#000000',
      paper: '#1C1C1E',
    },
    text: {
      primary: '#FFFFFF',
      secondary: 'rgba(255, 255, 255, 0.6)',
    },
    divider: 'rgba(255, 255, 255, 0.1)',
  },
  typography: lightTheme.typography,
  shape: {
    borderRadius: 12,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: '#000000',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: iOSButtonStyle,
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          ...iOSCardStyle,
          backgroundColor: 'rgba(28, 28, 30, 0.8)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: '16px',
          backgroundImage: 'none',
        },
      },
    },

  },
})

// 默认导出浅色主题
export const theme = lightTheme