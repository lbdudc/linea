# linea/server

API HTTP de LINEA: líneas de producto, productos, usuarios (OAuth de GitLab +
JWT), integración con GitLab (`gitlab-commando`), MongoDB y Socket.IO.

```bash
npm install
npm run dev      # desarrollo
npm start        # producción
npx vitest run   # tests (`npm test` es lo mismo; `npm run test:watch` vigila)
npm run lint
```

## Eventos de dominio

`src/model/events/domainEventBridge.js` (cableado desde `index.js`) reenvía
`PRODUCT_GENERATED` por HTTP a las URLs de `EVENT_WEBHOOK_URLS` (separadas por
comas), con la firma HMAC-SHA256 del cuerpo en `X-Linea-Signature`
(`sha256=<hex>`, clave `EVENT_WEBHOOK_SECRET`). Sin las dos variables no se envía
nada y LINEA funciona igual.

## Variables

`GITLAB_HOSTNAME`, `GITLAB_CLIENT_ID`, `GITLAB_SECRET_ID`, `REDIRECT_URI` para
el OAuth; `JWT_SIGN_KEY` para la sesión.

## Más contexto

- `docs/conocimiento/CONTEXTO.md` (raíz del workspace) — mapa del ecosistema.
- `linea/docs/splalm/` — documentación profunda del monolito.
