// Preset de PrimeVue 4 para LINEA y linea-agents.
//
// Mismos valores que `tokens.css`, dichos otra vez porque PrimeVue no lee
// nuestro fichero de variables. Si tocas uno, toca el otro: son el mismo
// diseño en dos sitios.
//
// Uso:
//   import PrimeVue from 'primevue/config';
//   import presetLinea from './preset-linea.js';
//   app.use(PrimeVue, {
//     theme: { preset: presetLinea, options: { darkModeSelector: '.dark-theme', cssLayer: false } },
//   });
//
// `darkModeSelector` debe apuntar a la MISMA clase que pone el fichero de
// tokens en la raíz, o los componentes de PrimeVue cambiarán de tema por su
// cuenta y se desincronizarán del CSS propio.

import { definePreset } from '@primevue/themes';
import Aura from '@primevue/themes/aura';

export default definePreset(Aura, {
  semantic: {
    primary: {
      color: '{primary.color}',
      contrastColor: '{primary.contrast.color}',
      hoverColor: '{primary.hover.color}',
      activeColor: '{primary.hover.color}',
    },

    colorScheme: {
      light: {
        surface: {
          0: '#ffffff',
          50: '#f5f7fa',
          100: '#eef2f7',
          200: '#e2e8f0',
        },
        primary: {
          // Índigo de marca. En claro el azul del tema oscuro no contrasta.
          color: '#222261',
          contrast: { color: '#ffffff' },
          hover: { color: '#2563eb' },
          active: { color: '#2563eb' },
        },
        content: {
          background: '#ffffff',
          hoverBackground: '#eef2f7',
          borderColor: '#e2e8f0',
        },
        text: {
          color: '#1e293b',
          mutedColor: '#475569',
        },
        highlight: {
          background: 'rgba(34, 34, 97, 0.09)',
          focusBackground: 'rgba(34, 34, 97, 0.13)',
          color: '#222261',
          focusColor: '#222261',
        },
      },

      dark: {
        surface: {
          0: '#f1f5f9',
          50: '#1e293b',
          100: '#334155',
          900: '#0f172a',
        },
        primary: {
          color: '#60a5fa',
          contrast: { color: '#ffffff' },
          hover: { color: '#93c5fd' },
          active: { color: '#93c5fd' },
        },
        content: {
          background: '#131f35',
          hoverBackground: '#1e293b',
          borderColor: '#334155',
        },
        text: {
          color: '#f1f5f9',
          mutedColor: '#94a3b8',
        },
        highlight: {
          background: 'rgba(96, 165, 250, 0.16)',
          focusBackground: 'rgba(96, 165, 250, 0.2)',
          color: '#f1f5f9',
          focusColor: '#f1f5f9',
        },
      },
    },
  },

  components: {
    floatlabel: {
      root: {
        color: '{text.muted.color}',
      },
    },

    button: {
      colorScheme: {
        dark: {
          root: {
            primary: {
              background: '#2563eb',
              borderColor: '#2563eb',
              hoverBackground: '#1d4ed8',
              hoverBorderColor: '#1d4ed8',
              activeBackground: '#1d4ed8',
              activeBorderColor: '#1d4ed8',
            },
          },
        },
      },
    },
  },
});
