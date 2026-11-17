import { createI18n } from 'vue-i18n'
import PrimeVue from 'primevue/config'
import ConfirmationService from 'primevue/confirmationservice'

import messages from 'src/i18n'

let instancia = null

export function createTestI18n() {
  if (!instancia) {
    instancia = createI18n({
      legacy: true,
      globalInjection: true,
      locale: 'es',
      fallbackLocale: 'en',
      messages,
    })
  }
  return instancia
}

export function mountGlobalPlugins() {
  return [createTestI18n(), PrimeVue, ConfirmationService]
}
