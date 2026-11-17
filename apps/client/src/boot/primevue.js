import PrimeVue from 'primevue/config'
import ToastService from 'primevue/toastservice'
import ConfirmationService from 'primevue/confirmationservice'
import presetLinea from 'src/theme/preset-linea'
import 'primeicons/primeicons.css'

export function installPrimeVue (app) {
  app.use(PrimeVue, {
    theme: {
      preset: presetLinea,
      options: {
        darkModeSelector: '.dark-theme',
        cssLayer: false,
      },
    },
  })

  app.use(ToastService)

  app.use(ConfirmationService)
}
