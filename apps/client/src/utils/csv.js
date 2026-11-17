const quote = (value) => {
  const text = value == null ? '' : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export const toCsv = (rows) => {
  if (!rows.length) return ''
  const columns = Object.keys(rows[0])
  return [columns.join(','), ...rows.map((row) => columns.map((column) => quote(row[column])).join(','))].join('\r\n')
}

export const downloadText = (filename, text, type = 'text/plain') => {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
