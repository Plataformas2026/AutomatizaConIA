# Automatización con IA

Alertas en **tiempo real** sobre hojas de cálculo de Google Drive, **sin copiar nunca los datos** del usuario.

- **Stack**: Next.js 15 (App Router) en Vercel · Supabase (Postgres + Auth + RLS + Realtime) · GitHub
- **Coste**: 0 € (con las salvedades de la sección *Riesgos*)

---

## 1. Cómo funciona

```
 Usuario edita su Excel/CSV/Sheet en Google Drive
                    │
                    ▼
 Google Drive ──(push, cuerpo vacío, cabeceras X-Goog-*)──► POST /api/webhooks/drive
                                                               │ 1. valida X-Goog-Channel-Token (HMAC)
                                                               │ 2. responde 200 de inmediato
                                                               ▼ after()
                                                    processFile(fileId)
                                                               │ 3. files.get → ¿cambió `version`?  (dedupe atómico)
                                                               │ 4. descarga A MEMORIA (nunca a disco/BD)
                                                               │ 5. evalúa reglas → solo nº de fila
                                                               │ 6. descarta los datos
                                                               ▼
                                              INSERT alerts (texto del usuario + nº de filas)
                                                               │
                                                               ▼
                                        Supabase Realtime ──► pestaña «Alertas» se actualiza sola
```

**Renovación de canales**: `files.watch` caduca como máximo a las **24 h**. `pg_cron` (Supabase) llama cada 6 h a
`/api/cron/renew-watches`, que crea un canal nuevo, para el viejo y reconcilia por `version` por si hubo hueco.

---

## 2. Decisiones de diseño clave

| Decisión | Motivo |
|---|---|
| Scope **`drive.file`** + **Google Picker** (no `drive.readonly`) | La app solo ve los archivos que el usuario elige. Mínimo privilegio y scope no sensible: evita la verificación restringida de Google. Encaja con el botón «Añadir/compartir otro archivo». |
| Refresh token **cifrado AES‑256‑GCM**, tabla sin políticas RLS | Solo `service_role` lo lee. El navegador solo recibe un access token de ~1 h para el Picker. |
| `X-Goog-Channel-Token` = HMAC del `channelId` | Autentica el webhook sin guardar secretos por canal. |
| Dedupe por `version` con compare‑and‑set en Postgres (`claim_file_version`) | Drive manda varias notificaciones por guardado; así se procesa una sola vez, aunque lleguen en paralelo. |
| Huella (`last_fingerprint`) por regla | Solo se alerta cuando **cambia** el conjunto de filas que cumple la regla; no se repite la misma alerta en cada edición. |
| Texto de alerta solo con `{count} {rows} {file} {rule}` | **Nunca** se copian valores de celdas a la alerta: preserva el zero‑storage. |
| `condition` y `actions` en **JSONB** validado con Zod | Añadir acciones (email, webhook…) u operadores no requiere migrar tablas. Las reglas se revalidan al evaluar (se pueden escribir vía PostgREST). |
| Sin reglas activas → no se descarga el archivo | Ahorra ancho de banda y tiempo de función. |
| Renovación con `pg_cron`, no con Vercel Cron | Vercel Hobby limita a 1 ejecución/día (±59 min); el canal dura ≤ 24 h. |

### Qué se guarda y qué no

| Se guarda | NO se guarda nunca |
|---|---|
| IDs de archivo de Drive, nombre, tipo, `version`, estado | Filas, celdas o columnas del archivo |
| Refresh token **cifrado** | Copias, cachés o exportaciones del archivo |
| Reglas (nombres de columna, operador, valor fijo que escribe el usuario) | Valores de celdas en alertas ni en logs |
| Alertas: texto del usuario, nº de filas (máx. 200), contador | Contenido de las filas afectadas |
| Huella HMAC de nº de fila (ilegible) | |

---

## 3. Riesgos y límites del plan gratuito (léelos antes de empezar)

1. **Vercel Hobby es solo para uso personal/no comercial.** Su propia documentación lo indica (política de uso justo).
   Si esto se ofrece a empresas como producto, lo correcto es Vercel Pro (20 $/usuario/mes) u otro hosting. El código es portable (solo usa Node + `fetch`).
2. **Verifica el webhook en la Fase 0.** Google exige HTTPS con certificado válido. Históricamente varias APIs de Google pedían
   registrar/verificar el dominio del receptor en Google Cloud; la guía actual de Drive no lo menciona, pero **pruébalo con tu URL real** (`*.vercel.app` o dominio propio) antes de construir nada más. Si lo exigiera, la única salida es un dominio propio (~10 €/año).
3. **Pantalla de consentimiento de Google**: si la dejas en modo *Testing*, los refresh tokens caducan a los 7 días. Pásala a *In production*. Con solo `drive.file`, `openid` y `email` no debería requerir revisión de scopes sensibles; confírmalo en tu consola.
4. **Supabase Free**: pausa el proyecto tras ~7 días sin actividad (la tarea de `pg_cron` genera actividad periódica; compruébalo) y el **SMTP integrado está muy limitado** → configura SMTP propio (Resend, Brevo… ambos con plan gratuito) o los enlaces de acceso se retrasarán/bloquearán.
5. **Límites funcionales del MVP**: solo la **primera hoja**; máx. 15 MB (`MAX_FILE_BYTES`) y 50 000 filas; las Hojas de Google se exportan como CSV (límite de Google ~10 MB); las fechas se comparan **por día**; `"1.234"` se interpreta como decimal 1,234 (ambigüedad inherente).
6. **Privacidad legal**: aunque no se persista nada, los datos **se procesan en memoria** en los servidores de Vercel/Supabase. Elige región UE en ambos y refléjalo en tu política de privacidad.
7. **Magic link con PKCE**: el enlace debe abrirse en el **mismo navegador** donde se pidió.

> **Estado de verificación**: el proyecto compila (`tsc` y `next build` sin errores), los tests del motor de reglas pasan y el parseo/evaluación se ha probado con `.xlsx` y `.csv` reales generados al vuelo. **No se ha probado contra Google ni Supabase reales** (requieren tus credenciales): la Fase 0 existe precisamente para validarlo.

---

## 4. Plan paso a paso

**Fase 0 — Spike de riesgo (½ día).** *Hecho cuando* un cambio en un archivo de Drive provoca una petición en tu endpoint.
1. Proyecto en Google Cloud → habilita **Google Drive API** y **Google Picker API**.
2. Despliega este repo en Vercel con variables mínimas y llama a `files.watch` sobre un archivo de prueba (puedes usar la Fase 2 ya montada).
3. Comprueba el punto de riesgo nº 2 (dominio) y que llega `X-Goog-Resource-State: update`.

**Fase 1 — Infra y acceso (½ día).**
1. Crea el proyecto Supabase (región UE) y ejecuta `supabase/migrations/0001_init.sql` en el *SQL Editor*.
2. Auth → *URL Configuration*: *Site URL* = tu URL; *Redirect URLs* = `https://tu-url/auth/callback` (y la de local).
3. Auth → SMTP propio. (Opcional: desactiva *Allow new users to sign up* y entra solo por invitación.)
4. Importa el repo en Vercel y rellena las variables de `.env.example`.

**Fase 2 — Conexión con Drive (1 día).**
1. Google Cloud → *Credenciales*: ID de cliente OAuth «Aplicación web» con redirect `https://tu-url/api/google/callback`; **API key** restringida por referer HTTP y a *Picker API*.
2. `NEXT_PUBLIC_GOOGLE_APP_ID` = número del proyecto de Google Cloud.
3. Prueba: login → *Conectar Google Drive* → *Añadir archivo* → el archivo aparece y su canal queda registrado.

**Fase 3 — Webhook y lectura efímera (1 día).**
1. Ejecuta `0002_cron_renewal.sql` (activa antes `pg_cron` y `pg_net`; sustituye URL y secreto).
2. Prueba de extremo a extremo: crea una regla → edita el archivo en Drive → la alerta aparece en segundos.
3. Revisa los logs de Vercel: no debe aparecer ningún dato de filas.

**Fase 4 — Reglas y alertas (1 día).** Ajustes de UX: edición de reglas, importancia, descartar/leer.

**Fase 5 — Endurecimiento (1–2 días).** Límite de peticiones en `/api/files/*/columns`, tipos de Supabase generados (`supabase gen types`), política de privacidad, vigilancia de errores sin datos, tests de integración.

---

## 5. Puesta en marcha local

```bash
npm install
cp .env.example .env.local     # rellénalo
npm run dev
```

Drive solo notifica a **HTTPS públicos**: para probar el webhook en local expón el puerto con un túnel
(`cloudflared tunnel --url http://localhost:3000` o `ngrok http 3000`) y pon esa URL en `NEXT_PUBLIC_APP_URL`
y en los redirects de Google/Supabase.

Generar secretos:
```bash
openssl rand -base64 32   # TOKEN_ENCRYPTION_KEY
openssl rand -hex 32      # WEBHOOK_SECRET
openssl rand -hex 32      # CRON_SECRET
```

Tests: `npm test` · Tipos: `npm run typecheck`

---

## 6. Estructura del proyecto

```
├─ supabase/migrations/
│  ├─ 0001_init.sql            tablas, RLS, privilegios, Realtime, claim_file_version()
│  └─ 0002_cron_renewal.sql    pg_cron + pg_net → renovación de canales cada 6 h
├─ vercel.json                 cron diario de respaldo
└─ src/
   ├─ middleware.ts            refresca sesión; protege páginas (no el webhook ni el cron)
   ├─ app/
   │  ├─ login/                enlace de acceso (Supabase Auth, OTP por correo)
   │  ├─ auth/{callback,signout}/
   │  ├─ (app)/
   │  │  ├─ dashboard/         conexión con Drive + lista de archivos + Picker
   │  │  ├─ files/[fileId]/    creador de reglas del archivo
   │  │  └─ alerts/            pestaña de alertas (Realtime)
   │  └─ api/
   │     ├─ google/{connect,callback,picker-token}/   OAuth y token para el Picker
   │     ├─ files/             alta (+ files.watch) · [fileId] baja · [fileId]/columns
   │     ├─ rules/             alta · [ruleId] PATCH/DELETE
   │     ├─ webhooks/drive/    ★ receptor de Google Drive
   │     └─ cron/renew-watches/  renovación (pg_cron / Vercel Cron)
   ├─ components/              DrivePicker · RulesPanel · AlertsList · FileActions
   └─ lib/
      ├─ env.ts · crypto.ts · auth.ts
      ├─ supabase/{server,admin,client,middleware}.ts
      ├─ google/{oauth,drive,watch}.ts
      ├─ parsing/parse.ts      xlsx/csv → tabla EN MEMORIA
      ├─ rules/{operators,types,engine,engine.test}.ts   ★ motor puro
      ├─ actions/index.ts      registro de acciones (alert hoy; email/webhook mañana)
      └─ pipeline/{process-file,renew-watch}.ts          ★ lectura efímera
```

---

## 7. Cómo extender

- **Nueva acción** (p. ej. email): añade su esquema Zod en `rules/types.ts` (pasa `actionSchema` a `z.discriminatedUnion`) y su handler en `actions/index.ts`. El pipeline no cambia.
- **Nuevo operador**: añádelo en `rules/operators.ts` (lista y etiqueta) y su caso en `compare()` de `rules/engine.ts`. Añade un test.
- **Condiciones compuestas (Y/O)**: `condition.kind` ya es discriminante; añade `{kind:'group', op, conditions[]}` en `types.ts` y recursión en `evaluateRule`. No hay migración de BD.
- **Varios usuarios por empresa**: el esquema ya los soporta (`company_members`); falta la pantalla de invitaciones.
- **Elegir hoja concreta de un Excel**: añadir `sheet_name` a `shared_files_metadata` y usarlo en `parseTable`.

## Estadísticas

La pestaña **Estadísticas** (`/stats`) permite montar un panel de gráficas propio: 12 tipos (barras, barras horizontales, barras apiladas, líneas, área, área apilada, tarta, donut, radar, dispersión, métrica KPI y tabla resumen), con desplegables para archivo, hoja, eje X, eje Y (suma, promedio, mediana, mínimo, máximo, recuento y valores distintos) y título.

- **Zero-storage**: los datos se leen de Drive al vuelo, se agregan en memoria y solo viajan al navegador cifras ya agregadas. En la base de datos solo se guarda la configuración de cada gráfica (`stats_charts`, migración `0004_stats_charts.sql`), con RLS por usuario.
- API: `POST /api/stats/query` (datos agregados), `GET /api/stats/structure` (hojas y columnas), `POST/PATCH/DELETE /api/stats/charts` (configuración).
