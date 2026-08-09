// YAML 编辑器（CodeMirror 6）
import React from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { yaml } from '@codemirror/lang-yaml'
import { oneDark } from '@codemirror/theme-one-dark'

export function YamlEditor({
  value,
  onChange,
  readOnly,
}: {
  value: string
  onChange?: (v: string) => void
  readOnly?: boolean
}) {
  return (
    <CodeMirror
      value={value}
      height="100%"
      theme={oneDark}
      extensions={[yaml()]}
      onChange={(v) => onChange?.(v)}
      readOnly={readOnly}
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: true,
        autocompletion: true,
      }}
    />
  )
}
