/** "3 days ago", "last month", "2 years ago": the age of a date in the coarsest unit that fits, from days up. */
export const relativeDays = (at, locale) => {
  const days = Math.round((Date.now() - new Date(at).getTime()) / 86400000)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (Math.abs(days) < 30) return rtf.format(-days, 'day')
  if (Math.abs(days) < 365) return rtf.format(-Math.round(days / 30), 'month')
  return rtf.format(-Math.round(days / 365), 'year')
}

/** "5 min. ago", "in 2 hr.": the distance to a date in days, hours, minutes or seconds, short. */
export const relativeShort = (at, locale = 'en') => {
  const seconds = Math.round((new Date(at).getTime() - Date.now()) / 1000)
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
  for (const [unit, size] of [['day', 86400], ['hour', 3600], ['minute', 60]]) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit)
  }
  return formatter.format(seconds, 'second')
}
