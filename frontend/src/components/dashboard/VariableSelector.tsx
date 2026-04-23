import { useState, useEffect, useCallback } from 'react'
import {
  Box,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  OutlinedInput,
  Chip,
  TextField,
} from '@mui/material'
import { DashboardVariable } from '../charts/types'
import { datasourceAPI } from '../../lib/datasource-api'

export type VariableValues = Record<string, string>

interface VariableSelectorProps {
  variables: DashboardVariable[]
  values: VariableValues
  onChange: (values: VariableValues) => void
}

export default function VariableSelector({ variables, values, onChange }: VariableSelectorProps) {
  const [optionsMap, setOptionsMap] = useState<Record<string, string[]>>({})

  const loadVariableOptions = useCallback(async (v: DashboardVariable) => {
    if (v.type === 'custom') {
      const opts = v.options || []
      setOptionsMap((prev) => ({ ...prev, [v.name]: v.includeAll ? ['All', ...opts] : opts }))
      return
    }
    if (v.type === 'text') {
      setOptionsMap((prev) => ({ ...prev, [v.name]: [] }))
      return
    }
    if (v.type === 'query' && v.query && v.dataSourceId) {
      try {
        const res = await datasourceAPI.queryVariables(v.dataSourceId, v.query, v.labelName)
        if (res.success && Array.isArray(res.data)) {
          const opts = v.includeAll ? ['All', ...res.data] : res.data
          setOptionsMap((prev) => ({ ...prev, [v.name]: opts }))
        }
      } catch {
        setOptionsMap((prev) => ({ ...prev, [v.name]: [] }))
      }
      // loading done
    }
  }, [])

  useEffect(() => {
    variables.forEach((v) => {
      if (!optionsMap[v.name]) {
        loadVariableOptions(v)
      }
    })
  }, [variables, loadVariableOptions, optionsMap])

  // 初始化默认值
  useEffect(() => {
    const next: VariableValues = { ...values }
    let changed = false
    variables.forEach((v) => {
      if (next[v.name] === undefined) {
        const opts = optionsMap[v.name] || []
        if (v.defaultValue) {
          next[v.name] = v.defaultValue
        } else if (opts.length > 0) {
          const firstOpt = opts[0]
          if (firstOpt === 'All' && v.includeAll) {
            const allOpts = opts.filter((o) => o !== 'All')
            next[v.name] = allOpts.join('|')
          } else {
            next[v.name] = firstOpt
          }
        } else if (v.type === 'text') {
          next[v.name] = ''
        }
        changed = true
      }
    })
    if (changed) {
      onChange(next)
    }
  }, [variables, optionsMap])

  const handleChange = (name: string, value: string | string[]) => {
    let val = Array.isArray(value) ? value.join('|') : value
    // "All" 选项展开为所有实际值的正则匹配格式
    if (val === 'All') {
      const allOpts = (optionsMap[name] || []).filter((o) => o !== 'All')
      val = allOpts.join('|')
    }
    onChange({ ...values, [name]: val })
  }

  if (variables.length === 0) return null

  return (
    <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
      {variables.map((v) => {
        const opts = optionsMap[v.name] || []
        const currentValue = values[v.name] || ''

        if (v.type === 'text') {
          return (
            <TextField
              key={v.name}
              label={v.label || v.name}
              size="small"
              value={currentValue}
              onChange={(e) => handleChange(v.name, e.target.value)}
              sx={{ minWidth: 120 }}
            />
          )
        }

        if (v.multi) {
          const selected = currentValue ? currentValue.split('|') : []
          return (
            <FormControl key={v.name} size="small" sx={{ minWidth: 140 }}>
              <InputLabel>{v.label || v.name}</InputLabel>
              <Select
                multiple
                value={selected}
                onChange={(e) => handleChange(v.name, e.target.value as string[])}
                input={<OutlinedInput label={v.label || v.name} />}
                renderValue={(selected) => (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {(selected as string[]).map((val) => (
                      <Chip key={val} label={val} size="small" />
                    ))}
                  </Box>
                )}
              >
                {opts.map((opt) => (
                  <MenuItem key={opt} value={opt}>
                    {opt}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )
        }

        return (
          <FormControl key={v.name} size="small" sx={{ minWidth: 140 }}>
            <InputLabel>{v.label || v.name}</InputLabel>
            <Select
              value={currentValue}
              label={v.label || v.name}
              onChange={(e) => handleChange(v.name, e.target.value)}
            >
              {opts.map((opt) => (
                <MenuItem key={opt} value={opt}>
                  {opt}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )
      })}
    </Box>
  )
}
