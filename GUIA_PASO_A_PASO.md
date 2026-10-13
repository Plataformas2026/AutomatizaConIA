# Entrega 9 · Guía paso a paso

## Qué cambia
1. **Proyectos compartidos**: botón «Compartir» en cada proyecto (invitas por correo). La otra persona lo ve en su Dashboard («Compartidos conmigo») con archivos, alertas y estadísticas, **solo lectura**.
2. **Alertas y estadísticas por proyecto**: cada alerta hereda el proyecto de su archivo; Estadísticas tiene selector de proyecto y cada gráfica se guarda dentro de uno.
3. **Informes IA sin guardar**: se eliminó «Informes guardados». Se genera al vuelo y se descarga («Descargar informe», HTML autocontenido; también Imprimir/PDF y CSV).
4. **Correo en las reglas**: casilla «Enviar también un correo (Outlook)» con remitente, destinatario, asunto, mensaje y datos del Excel (`{col:Importe}`…). Un correo por fila (máx. 25) o uno resumen.
5. **Pendientes**: si nadie lo envía automáticamente, sale en el Dashboard: «Tienes pendiente mandar el correo X» con botones Abrir en Outlook / Outlook web / Copiar / Ya lo he enviado / Descartar. Al resolverlo, el contenido se borra.
6. **Envío automático opcional** (agente local, Outlook de Windows): `EMAIL_MODE=off|draft|send`.

## Pasos
1. **Antes de nada**: si tienes informes IA guardados que quieras conservar, ábrelos y descárgalos/imprímelos. La migración los borra definitivamente.
2. Copia los archivos del ZIP respetando rutas y **borra** estos tres:
   - `src/components/ml/SavedReports.tsx`
   - `src/app/api/ml/reports/route.ts`
   - `src/app/api/ml/reports/[reportId]/route.ts`
3. Supabase → SQL Editor → New query → pega `supabase/migrations/0008_project_sharing_email.sql` → Run (debe acabar en «Success»; se puede repetir sin problema).
4. Supabase → Authentication → Providers → Email: deja **«Confirm email» activado** (las invitaciones solo se reclaman con correo confirmado).
5. `git push` y espera al despliegue de Vercel. No hay variables nuevas.
6. Probar compartir: abre un proyecto → «Compartir» → escribe el correo de otra cuenta → esa persona entra (o recarga el Dashboard) y verá el proyecto en «Compartidos conmigo».
7. Probar correo: archivo → Nueva regla → marca «Enviar también un correo» → guarda. Al cumplirse, aparece en el Dashboard.
8. Agente local (si lo usas): copia `agent/` actualizado (conserva tu `.env`), ejecuta `.venv\Scripts\python.exe -m pip install -r requirements.txt`, y si quieres envío automático añade a `.env` las líneas de `EMAIL_*` (ver `.env.example`). Empieza con `draft`.

## Limitaciones honestas
- El envío por Outlook (COM/pywin32) **no he podido probarlo contra un Outlook real**; sí están probados la lógica, los límites, los dominios y la redacción (30 pruebas Python y 40 web). Pruébalo primero en modo `draft`. Solo Outlook clásico de Windows.
- Quien recibe un proyecto compartido ve los **nombres y estado de los archivos** (incluida la ruta local si es un archivo de tu PC) y puede ver los datos agregados de sus gráficas; no ve reglas ni correos pendientes.
- La invitación se reclama cuando la persona abre su Dashboard.
- Las estadísticas y modelos IA siguen sin funcionar con archivos locales (no salen de tu PC).
- Máximo 25 correos por regla y evaluación; correos idénticos se unen en uno. Los correos del Excel pasan a la web solo mientras están pendientes (se purgan a los 7 días de resolverse o 30 de olvidados).
- Quien recibe un proyecto compartido ya no verá sus alertas en el contador del menú (solo cuentan las tuyas).
