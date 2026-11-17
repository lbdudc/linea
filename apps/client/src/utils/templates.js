export const defaultTemplate = (templates) => {
  if (!templates?.length) return null
  return templates.find((template) => template.name.toLowerCase() === 'default') ?? (templates.length === 1 ? templates[0] : null)
}

export const withTemplate = ({ description, previous, next }) => {
  const untouched = !description.trim() || description === (previous?.content ?? '')
  if (untouched) return next?.content ?? ''
  if (!next) return description
  return `${description.replace(/\s+$/, '')}\n\n${next.content}`
}
