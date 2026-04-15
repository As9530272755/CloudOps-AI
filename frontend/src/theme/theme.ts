import { createTheme } from '@mui/material/styles'

// ==================== iOS Minimalist Design Tokens ====================
const colors = {
  primary: {
    main: '#111827',      // near-black for primary actions
    light: '#374151',
    dark: '#000000',
    contrastText: '#FFFFFF',
  },
  secondary: {
    main: '#6366F1',      // soft indigo accent
    light: '#818CF8',
    dark: '#4F46E5',
    contrastText: '#FFFFFF',
  },
  success: {
    main: '#10B981',
    light: '#34D399',
    dark: '#059669',
    contrastText: '#FFFFFF',
  },
  warning: {
    main: '#F59E0B',
    light: '#FBBF24',
    dark: '#D97706',
    contrastText: '#FFFFFF',
  },
  error: {
    main: '#EF4444',
    light: '#F87171',
    dark: '#DC2626',
    contrastText: '#FFFFFF',
  },
  grey: {
    50: '#FAFAFA',
    100: '#F3F4F6',
    200: '#E5E7EB',
    300: '#D1D5DB',
    400: '#9CA3AF',
    500: '#6B7280',
    600: '#4B5563',
    700: '#374151',
    800: '#1F2937',
    900: '#111827',
  },
}

// ==================== Shared Component Styles ====================
const buttonRoot = {
  borderRadius: '10px',
  textTransform: 'none' as const,
  fontWeight: 500,
  fontSize: '0.875rem',
  letterSpacing: '-0.01em',
  padding: '8px 16px',
  boxShadow: 'none',
  transition: 'all 0.2s ease',
  '&:hover': {
    boxShadow: 'none',
    transform: 'translateY(-1px)',
  },
  '&:active': {
    transform: 'translateY(0)',
  },
}

const cardRoot = {
  borderRadius: '12px',
  border: '1px solid',
  borderColor: colors.grey[200],
  boxShadow: 'none',
  backgroundImage: 'none',
}

const paperRoot = {
  borderRadius: '12px',
  backgroundImage: 'none',
}

const inputRoot = {
  borderRadius: '10px',
  backgroundColor: colors.grey[50],
  '& fieldset': {
    borderColor: colors.grey[200],
  },
  '&:hover fieldset': {
    borderColor: colors.grey[300],
  },
  '&.Mui-focused fieldset': {
    borderColor: colors.primary.main,
    borderWidth: '1px',
  },
}

// ==================== Light Theme ====================
export const lightTheme = createTheme({
  palette: {
    mode: 'light',
    primary: colors.primary,
    secondary: colors.secondary,
    success: colors.success,
    warning: colors.warning,
    error: colors.error,
    background: {
      default: colors.grey[50],
      paper: '#FFFFFF',
    },
    text: {
      primary: colors.grey[900],
      secondary: colors.grey[500],
    },
    divider: colors.grey[200],
  },
  typography: {
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif',
    h1: {
      fontSize: '2rem',
      fontWeight: 600,
      letterSpacing: '-0.02em',
      lineHeight: 1.2,
    },
    h2: {
      fontSize: '1.5rem',
      fontWeight: 600,
      letterSpacing: '-0.02em',
      lineHeight: 1.3,
    },
    h3: {
      fontSize: '1.25rem',
      fontWeight: 600,
      letterSpacing: '-0.01em',
      lineHeight: 1.4,
    },
    h4: {
      fontSize: '1.125rem',
      fontWeight: 600,
      letterSpacing: '-0.01em',
      lineHeight: 1.4,
    },
    h5: {
      fontSize: '1rem',
      fontWeight: 600,
      letterSpacing: '-0.01em',
      lineHeight: 1.4,
    },
    h6: {
      fontSize: '0.9375rem',
      fontWeight: 600,
      letterSpacing: '-0.01em',
      lineHeight: 1.4,
    },
    body1: {
      fontSize: '0.9375rem',
      lineHeight: 1.6,
      letterSpacing: '-0.01em',
    },
    body2: {
      fontSize: '0.875rem',
      lineHeight: 1.6,
      letterSpacing: '-0.01em',
    },
    button: {
      fontWeight: 500,
      letterSpacing: '-0.01em',
      textTransform: 'none',
    },
    caption: {
      fontSize: '0.8125rem',
      lineHeight: 1.5,
      letterSpacing: '-0.01em',
    },
    overline: {
      fontSize: '0.75rem',
      fontWeight: 500,
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
    },
  },
  shape: {
    borderRadius: 10,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: colors.grey[50],
        },
        '*': {
          scrollbarWidth: 'thin',
          scrollbarColor: `${colors.grey[300]} transparent`,
        },
        '::-webkit-scrollbar': {
          width: '8px',
          height: '8px',
        },
        '::-webkit-scrollbar-thumb': {
          backgroundColor: colors.grey[300],
          borderRadius: '4px',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: buttonRoot,
        containedPrimary: {
          backgroundColor: colors.primary.main,
          color: colors.primary.contrastText,
          '&:hover': {
            backgroundColor: colors.primary.light,
          },
        },
        containedSecondary: {
          backgroundColor: colors.secondary.main,
          color: colors.secondary.contrastText,
          '&:hover': {
            backgroundColor: colors.secondary.light,
          },
        },
        outlined: {
          borderColor: colors.grey[200],
          '&:hover': {
            backgroundColor: colors.grey[50],
            borderColor: colors.grey[300],
          },
        },
        sizeSmall: {
          padding: '6px 12px',
          fontSize: '0.8125rem',
        },
        sizeLarge: {
          padding: '10px 20px',
          fontSize: '0.9375rem',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: cardRoot,
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: paperRoot,
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: inputRoot,
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': inputRoot,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: '8px',
          fontWeight: 500,
          fontSize: '0.8125rem',
          backgroundColor: colors.grey[100],
          color: colors.grey[700],
          '&.MuiChip-colorPrimary': {
            backgroundColor: colors.primary.main,
            color: colors.primary.contrastText,
          },
          '&.MuiChip-colorSuccess': {
            backgroundColor: colors.success.main,
            color: colors.success.contrastText,
          },
          '&.MuiChip-colorError': {
            backgroundColor: colors.error.main,
            color: colors.error.contrastText,
          },
          '&.MuiChip-colorWarning': {
            backgroundColor: colors.warning.main,
            color: colors.warning.contrastText,
          },
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 500,
          fontSize: '0.9375rem',
          minHeight: '44px',
          borderRadius: '8px',
          '&.Mui-selected': {
            fontWeight: 600,
          },
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        indicator: {
          height: '2px',
          borderRadius: '1px',
          backgroundColor: colors.primary.main,
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: '14px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.12)',
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottom: `1px solid ${colors.grey[100]}`,
          padding: '14px 16px',
          fontSize: '0.875rem',
        },
        head: {
          fontWeight: 600,
          color: colors.grey[600],
          fontSize: '0.8125rem',
          letterSpacing: '-0.01em',
          backgroundColor: colors.grey[50],
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          '&:hover': {
            backgroundColor: colors.grey[50],
          },
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: '10px',
          '&.Mui-selected': {
            backgroundColor: colors.grey[100],
            color: colors.grey[900],
          },
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: '10px',
          fontSize: '0.875rem',
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: colors.grey[800],
          color: '#fff',
          fontSize: '0.8125rem',
          borderRadius: '8px',
          padding: '6px 10px',
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          borderRadius: '10px',
          color: colors.grey[600],
          '&:hover': {
            backgroundColor: colors.grey[100],
            color: colors.grey[900],
          },
        },
      },
    },
    MuiPaginationItem: {
      styleOverrides: {
        root: {
          borderRadius: '8px',
          fontWeight: 500,
        },
      },
    },
    MuiSelect: {
      styleOverrides: {
        root: {
          borderRadius: '10px',
          backgroundColor: colors.grey[50],
        },
      },
    },
    MuiAutocomplete: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            ...inputRoot,
            padding: '4px 10px',
          },
        },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          borderRadius: '8px',
          borderColor: colors.grey[200],
          textTransform: 'none',
          fontWeight: 500,
          fontSize: '0.8125rem',
          '&.Mui-selected': {
            backgroundColor: colors.grey[900],
            color: '#fff',
            '&:hover': {
              backgroundColor: colors.grey[800],
            },
          },
        },
      },
    },
    MuiToggleButtonGroup: {
      styleOverrides: {
        root: {
          gap: '4px',
          borderRadius: '10px',
          backgroundColor: colors.grey[100],
          padding: '4px',
          border: 'none',
          '& .MuiToggleButton-root': {
            border: 'none',
            borderRadius: '8px !important',
            '&.Mui-selected': {
              backgroundColor: '#fff',
              color: colors.grey[900],
              boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
            },
          },
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          borderRight: `1px solid ${colors.grey[200]}`,
          backgroundColor: '#fff',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#fff',
          borderBottom: `1px solid ${colors.grey[200]}`,
          boxShadow: 'none',
        },
      },
    },
  },
})

// ==================== Dark Theme ====================
export const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#F3F4F6',
      light: '#FFFFFF',
      dark: '#D1D5DB',
      contrastText: '#111827',
    },
    secondary: {
      main: '#818CF8',
      light: '#A5B4FC',
      dark: '#6366F1',
      contrastText: '#FFFFFF',
    },
    success: {
      main: '#34D399',
      light: '#6EE7B7',
      dark: '#10B981',
      contrastText: '#111827',
    },
    warning: {
      main: '#FBBF24',
      light: '#FCD34D',
      dark: '#F59E0B',
      contrastText: '#111827',
    },
    error: {
      main: '#F87171',
      light: '#FCA5A5',
      dark: '#EF4444',
      contrastText: '#111827',
    },
    background: {
      default: '#0B0F19',
      paper: '#111827',
    },
    text: {
      primary: '#F3F4F6',
      secondary: '#9CA3AF',
    },
    divider: 'rgba(255,255,255,0.08)',
  },
  typography: lightTheme.typography,
  shape: {
    borderRadius: 10,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: '#0B0F19',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          ...buttonRoot,
          '&.Mui-disabled': {
            color: 'rgba(255,255,255,0.3)',
          },
        },
        containedPrimary: {
          backgroundColor: '#F3F4F6',
          color: '#111827',
          '&:hover': {
            backgroundColor: '#FFFFFF',
          },
        },
        outlined: {
          borderColor: 'rgba(255,255,255,0.15)',
          color: '#F3F4F6',
          '&:hover': {
            backgroundColor: 'rgba(255,255,255,0.05)',
            borderColor: 'rgba(255,255,255,0.25)',
          },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          ...cardRoot,
          backgroundColor: '#111827',
          borderColor: 'rgba(255,255,255,0.08)',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          ...paperRoot,
          backgroundColor: '#111827',
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: '10px',
          backgroundColor: 'rgba(255,255,255,0.03)',
          '& fieldset': {
            borderColor: 'rgba(255,255,255,0.1)',
          },
          '&:hover fieldset': {
            borderColor: 'rgba(255,255,255,0.2)',
          },
          '&.Mui-focused fieldset': {
            borderColor: '#F3F4F6',
            borderWidth: '1px',
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: '8px',
          backgroundColor: 'rgba(255,255,255,0.08)',
          color: '#E5E7EB',
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        },
        head: {
          backgroundColor: 'rgba(255,255,255,0.03)',
          color: '#9CA3AF',
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          '&:hover': {
            backgroundColor: 'rgba(255,255,255,0.03)',
          },
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: '10px',
          '&.Mui-selected': {
            backgroundColor: 'rgba(255,255,255,0.08)',
            color: '#fff',
          },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          color: '#9CA3AF',
          '&:hover': {
            backgroundColor: 'rgba(255,255,255,0.08)',
            color: '#fff',
          },
        },
      },
    },
    MuiToggleButtonGroup: {
      styleOverrides: {
        root: {
          backgroundColor: 'rgba(255,255,255,0.05)',
          '& .MuiToggleButton-root': {
            '&.Mui-selected': {
              backgroundColor: '#1F2937',
              color: '#fff',
            },
          },
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          borderRight: '1px solid rgba(255,255,255,0.08)',
          backgroundColor: '#0B0F19',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#0B0F19',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        },
      },
    },
  },
})

// Default export
export const theme = lightTheme
