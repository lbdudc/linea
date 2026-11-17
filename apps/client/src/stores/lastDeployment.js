import { reactive } from 'vue'

export const lastDeployment = reactive({ value: null })

export function rememberLastDeployment(deployment) {
  if (!deployment) return
  const known = lastDeployment.value
  if (!known || new Date(deployment.deployedAt) >= new Date(known.deployedAt)) lastDeployment.value = deployment
}
