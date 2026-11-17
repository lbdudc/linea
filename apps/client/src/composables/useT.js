import { getCurrentInstance } from 'vue'

/** The `$t` of the component that calls it, for `<script setup>` code; the key itself when there is no component. */
export const useT = () => {
  const instance = getCurrentInstance()
  return (key, ...args) => instance?.proxy?.$t(key, ...args) ?? key
}
