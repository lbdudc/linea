export function middleTruncate(text, max = 26) {
  const value = String(text ?? '')
  if (value.length <= max) return value
  const tail = Math.ceil((max - 1) * 0.45)
  const head = max - 1 - tail
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`
}
