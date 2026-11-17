import { ref, watch } from 'vue'

const CHUNK = 10

export const useDeletable = ({ ids, ask }) => {
  const denied = ref({})
  const asked = new Set()

  watch(() => ids().join(','), async () => {
    const missing = ids().filter((id) => !asked.has(id))
    missing.forEach((id) => asked.add(id))
    for (let start = 0; start < missing.length; start += CHUNK) {
      const chunk = missing.slice(start, start + CHUNK)
      try {
        const answer = await ask(chunk)
        denied.value = { ...denied.value, ...Object.fromEntries(chunk.map((id) => [id, answer?.[id] === false])) }
      } catch {
        chunk.forEach((id) => asked.delete(id))
      }
    }
  }, { immediate: true })

  return (id) => denied.value[id] === true
}
