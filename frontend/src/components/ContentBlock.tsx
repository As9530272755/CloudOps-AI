import React, { memo } from 'react'
import { Box, IconButton, useTheme } from '@mui/material'
import { ContentCopy as CopyIcon } from '@mui/icons-material'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export async function copyToClipboard(text: string) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return
    }
    const textArea = document.createElement('textarea')
    textArea.value = text
    textArea.style.position = 'fixed'
    textArea.style.left = '-9999px'
    textArea.style.top = '0'
    document.body.appendChild(textArea)
    textArea.focus()
    textArea.select()
    const success = document.execCommand('copy')
    document.body.removeChild(textArea)
    if (!success) {
      console.error('Copy failed')
    }
  } catch (e) {
    console.error('Copy failed', e)
  }
}

const ContentBlock = memo(function ContentBlock({ content }: { content: string }) {
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  return (
    <Box
      sx={{
        '& p': { m: 0, mb: 1 },
        '& p:last-child': { mb: 0 },
        '& ul, & ol': { pl: 2, m: 0, mb: 1 },
        '& li': { mb: 0.5 },
        '& h1, & h2, & h3, & h4, & h5, & h6': { mt: 1, mb: 1, fontWeight: 600 },
        '& a': { color: 'primary.main' },
        '& blockquote': {
          borderLeft: '4px solid',
          borderColor: 'divider',
          pl: 1,
          ml: 0,
          color: 'text.secondary',
        },
        '& table': { borderCollapse: 'collapse', width: '100%' },
        '& th, & td': { border: '1px solid', borderColor: 'divider', p: 0.5 },
        '& pre': { m: 0 },
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre({ children }: any) {
            const codeText = React.Children.toArray(children)
              .map((c: any) => c?.props?.children)
              .join('')
            return (
              <Box sx={{ position: 'relative', my: 1 }}>
                <IconButton
                  size="small"
                  onClick={() => copyToClipboard(codeText)}
                  sx={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    color: isDark ? '#ccc' : '#333',
                    bgcolor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.7)',
                    '&:hover': { bgcolor: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.9)' },
                    zIndex: 1,
                  }}
                >
                  <CopyIcon sx={{ fontSize: 14 }} />
                </IconButton>
                <Box
                  component="pre"
                  sx={{
                    backgroundColor: isDark ? '#1e1e1e' : '#f5f5f5',
                    color: isDark ? '#d4d4d4' : '#333',
                    p: 1.5,
                    pr: 4,
                    borderRadius: 1,
                    overflowX: 'auto',
                    fontFamily: 'monospace',
                    fontSize: 13,
                    m: 0,
                  }}
                >
                  {children}
                </Box>
              </Box>
            )
          },
          code({ inline, className, children, ...props }: any) {
            if (inline) {
              return (
                <code
                  style={{
                    backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
                    padding: '2px 4px',
                    borderRadius: 4,
                    fontFamily: 'monospace',
                    fontSize: '0.9em',
                  }}
                  className={className}
                  {...props}
                >
                  {children}
                </code>
              )
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            )
          },
          table({ children }: any) {
            return (
              <Box sx={{ overflowX: 'auto', my: 1 }}>
                <table style={{ borderCollapse: 'collapse', width: '100%' }}>{children}</table>
              </Box>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </Box>
  )
})

export default ContentBlock
