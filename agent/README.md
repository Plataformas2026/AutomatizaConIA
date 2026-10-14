# Agente local · Automatización con IA

Vigila archivos Excel/CSV **de tu ordenador** con Watchdog, aplica tus reglas y manda a la web solo los avisos.
**El archivo no sale de tu PC.**

## Qué sale de tu ordenador (y qué no)

| Sale hacia Supabase | NO sale nunca |
|---|---|
| Nombres de hojas y de columnas (para el creador de reglas) | Filas, celdas o valores del archivo |
| Avisos: el texto que escribiste en la regla + **números de fila** | El archivo, ni copias, ni capturas |
| Estado del archivo (ok / error) y una huella de versión (16 caracteres) | Rutas fuera de las carpetas que autorizas |

Además:

- El agente **no usa la clave `service_role`**. Usa un token propio, revocable desde la web, que solo permite 3 operaciones y solo sobre los archivos de ese agente.
- El agente **solo lee dentro de las carpetas que pongas en `WATCH_FOLDERS`**. Aunque alguien cambiara una ruta en la web, no podría hacer que abra otra cosa.
- No hay ningún puerto abierto hacia fuera: el agente solo hace peticiones HTTPS **hacia** Supabase.

---

## Antes de empezar

- Windows 10 u 11, con tu usuario de siempre.
- Haber desplegado la web con esta versión (te lo explico en el paso 1).
- Unos 15 minutos.

---

## Paso 1 · Preparar la web (solo la primera vez)

1. En Supabase abre **SQL Editor → New query**, pega el contenido de `supabase/migrations/0007_local_agent.sql` y pulsa **Run**. Debe terminar con «Success».
2. Despliega la web (push a GitHub; Vercel lo hace solo).
3. Entra en la web → **Dashboard** → panel «Vigilar archivos de tu ordenador» → **Configurar el agente local**.
4. Escribe un nombre (por ejemplo «PC de la oficina») y pulsa **Crear agente**.
5. Aparece un cuadro oscuro con 5 líneas (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `AGENT_TOKEN`, `WATCH_FOLDERS`…).
   **Pulsa «Copiar» y déjalo a mano.** El token solo se muestra una vez. Si lo pierdes: elimina el agente y crea otro.

## Paso 2 · Instalar Python

1. Entra en <https://www.python.org/downloads/windows/> y descarga **Python 3.11 o superior** (instalador de 64 bits).
2. Ejecútalo. **En la primera pantalla marca la casilla «Add python.exe to PATH»** y pulsa **Install Now**.
3. Comprueba: pulsa la tecla Windows, escribe `cmd`, Intro, y escribe `python --version`. Debe responder algo como `Python 3.12.x`.

## Paso 3 · Copiar el agente e instalar sus piezas

1. Crea la carpeta `C:\AutomatizacionIA`.
2. Copia dentro la carpeta **`agent`** de este proyecto. Debe quedar `C:\AutomatizacionIA\agent\agent.py`.
3. Abre **cmd** y ejecuta, línea a línea (Intro tras cada una):

   ```bat
   cd C:\AutomatizacionIA\agent
   python -m venv .venv
   .venv\Scripts\python.exe -m pip install --upgrade pip
   .venv\Scripts\python.exe -m pip install -r requirements.txt
   ```

   La última línea instala Watchdog, openpyxl, xlrd y requests. Tarda uno o dos minutos.

## Paso 4 · Crear el archivo `.env`

1. En `C:\AutomatizacionIA\agent` copia `.env.example` y renombra la copia a **`.env`** (sin «.example»).
   *Si no ves las extensiones: en el Explorador, pestaña **Ver → Mostrar → Extensiones de nombre de archivo**.*
2. Ábrelo con el Bloc de notas y **pega el bloque que copiaste de la web** (sustituye todo el contenido).
3. Cambia la línea `WATCH_FOLDERS` por las carpetas donde tienes tus Excel/CSV. Varias carpetas se separan con punto y coma:

   ```
   WATCH_FOLDERS=C:\Users\Marta\Documents;D:\Contabilidad
   ```

   - Las carpetas deben existir. El agente mira también las subcarpetas.
   - No hace falta poner comillas.
4. Guarda (Archivo → Guardar). Si el Bloc de notas pregunta la codificación, deja **UTF-8**.
5. *(Recomendado)* Que solo tu usuario pueda leerlo. En cmd:

   ```bat
   icacls .env /inheritance:r /grant:r "%USERNAME%:R"
   ```

## Paso 5 · Probarlo a mano

1. Doble clic en **`comprobar_agente.bat`**. Debe mostrar:

   ```
   ✓ Conexión con Supabase correcta. Agente: «PC de la oficina»
   ```

   Si falla, mira «Si algo no funciona» al final.
2. En la web: **Dashboard → Elegir archivos** (panel «Vigilar archivos de tu ordenador»). Elige tu Excel o CSV.
   *El navegador solo lee el nombre: no sube nada.* Pulsa **Empezar a vigilar**.
3. Doble clic en **`iniciar_agente.bat`**. Deja la ventana abierta. En unos segundos verás:

   ```
   «Inventario.xlsx»: 0 regla(s) evaluadas, 0 alerta(s) nueva(s)
   ```

4. En la web, entra en el archivo (**Reglas y hojas**): ya aparecen sus hojas y columnas. Crea una regla (por ejemplo «Stock es menor que 10»).
   En menos de un minuto el agente la evalúa y, si hay filas que la cumplen, verás el aviso en la pestaña **Alertas**.
5. Abre el Excel, cambia un valor y **guarda**. A los 3–4 segundos el agente lo detecta (lo verás en la ventana) y avisa si el conjunto de filas cambió.
6. Cierra la ventana del agente. Ahora lo automatizamos.

## Paso 6 · Que arranque solo (Programador de tareas)

### Opción A · Con un script (2 clics)

1. En `C:\AutomatizacionIA\agent` haz clic derecho sobre **`instalar_tarea.ps1`** → **Ejecutar con PowerShell**.
2. Si Windows dice que la ejecución de scripts está deshabilitada, abre **PowerShell** y ejecuta una sola vez:
   `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (responde `S`), y repite el paso 1.
3. Verás «Listo: la tarea … está creada y en marcha».

### Opción B · A mano, paso a paso

1. Pulsa **Windows + R**, escribe `taskschd.msc` y pulsa Intro.
2. En el panel derecho, **Crear tarea…** (**no** «Crear tarea básica»).
3. Pestaña **General**
   - Nombre: `Automatizacion con IA - Agente`
   - Marca **Ejecutar solo cuando el usuario haya iniciado sesión**.
   - Deja desmarcado «Ejecutar con los privilegios más altos».
4. Pestaña **Desencadenadores** → **Nuevo…**
   - Iniciar la tarea: **Al iniciar sesión**.
   - Usuario: **Usuario específico** (el tuyo).
   - Marca **Retrasar tarea hasta** → **30 segundos**.
   - Marca **Habilitada** → **Aceptar**.
5. Pestaña **Acciones** → **Nueva…**
   - Acción: **Iniciar un programa**.
   - Programa o script: `C:\AutomatizacionIA\agent\.venv\Scripts\pythonw.exe`
   - Agregar argumentos: `agent.py`
   - Iniciar en: `C:\AutomatizacionIA\agent`
   - **Aceptar**.
   *(`pythonw.exe` es Python sin ventana negra.)*
6. Pestaña **Condiciones**
   - **Desmarca** «Iniciar la tarea solo si el equipo está conectado a la corriente alterna».
   - **Desmarca** «Detener si el equipo deja de estar conectado a la corriente alterna».
7. Pestaña **Configuración**
   - Marca «Permitir ejecutar la tarea a petición».
   - Marca «Ejecutar la tarea lo antes posible si no se inició a la hora programada».
   - Marca «Si la tarea no se ejecuta correctamente, reiniciar cada: **1 minuto**», «Intentar reiniciar hasta: **999** veces».
   - **Desmarca** «Detener la tarea si se ejecuta durante más de: 3 días».
   - «Si la tarea ya se está ejecutando, la siguiente regla se aplica»: **No iniciar una nueva instancia**.
8. **Aceptar** (si te pide la contraseña de Windows, escríbela: es la de tu usuario).
9. Clic derecho sobre la tarea → **Ejecutar**. En 30–60 s la web mostrará el agente como **Conectado**.

> **Importante:** con esta configuración el agente funciona mientras tu sesión de Windows está iniciada (aunque esté bloqueada). Si lo necesitas incluso sin sesión, en la pestaña General elige «Ejecutar tanto si el usuario inició sesión como si no» (te pedirá la contraseña) y borra la opción de «Ejecutar solo cuando…».

### Comprobar que funciona de verdad

1. Reinicia el ordenador e inicia sesión.
2. Espera un minuto. En la web (Dashboard → Gestionar agentes) debe poner **Conectado**.
3. Cambia y guarda un Excel vigilado: debe aparecer la alerta.
4. El registro está en `C:\AutomatizacionIA\agent\agent.log` (no contiene datos de tus archivos, solo nombres de archivo y recuentos).

---

## Cómo funciona (por si te interesa)

- **Watchdog** vigila la carpeta de cada archivo. Al guardar, espera 3 s de calma (Excel guarda en varios pasos), lee el archivo en memoria, lo compara con la última versión (huella) y, si cambió, evalúa las reglas.
- **Cada 30 s** consulta si hay reglas, hojas o archivos nuevos y revisa que no se le escape ningún cambio.
- **No repite avisos**: solo avisa cuando cambia *qué filas* cumplen la regla (igual que la web con Drive).
- Si falla la red, reintenta solo y no pierde nada. Si el archivo está abierto/bloqueado, reintenta.
- Los archivos `.xls`, `.xlsx`, `.xlsm` y `.csv` están soportados. Los CSV pueden usar `,` `;` tabulador o `|`.

## Si algo no funciona

| Síntoma | Qué hacer |
|---|---|
| `Faltan valores en el archivo .env` | El archivo se llama `.env.txt` o está vacío. Activa «Extensiones de nombre de archivo» y renómbralo. |
| `La carpeta de WATCH_FOLDERS no existe` | Revisa la ortografía y que las carpetas estén separadas por `;`. |
| `El token no es válido` | Token mal copiado (sin espacios) o agente eliminado en la web. Crea otro agente y actualiza `.env`. |
| `Falta ejecutar la migración 0007…` | Haz el paso 1.1. |
| `Clave anon rechazada` | `SUPABASE_ANON_KEY` incorrecta (es la «anon public» de Supabase → Project Settings → API). |
| En la web: «No se encuentra «x» en las carpetas autorizadas» | El archivo no está dentro de `WATCH_FOLDERS`, o se llama distinto. |
| «Hay 2 archivos llamados…» | Pega la **ruta completa** del archivo en su ficha (Dashboard → Reglas y hojas → «Ruta completa»). |
| «La ruta indicada no está dentro de las carpetas autorizadas» | Añade esa carpeta a `WATCH_FOLDERS` y reinicia el agente. |
| «El archivo está bloqueado por otro programa» | Cierra lo que lo tenga abierto en exclusiva; se reintenta solo. |
| Excel protegido con contraseña | No se puede leer: quita la contraseña del archivo vigilado. |
| El agente sale «Sin conexión» en la web | Mira `agent.log`. Abre el Programador de tareas y comprueba que la tarea está «En ejecución». |

Para ver el registro en directo: `iniciar_agente.bat` (con la tarea parada) o abre `agent.log`.

## Cambiar la configuración o actualizar

- Cambios en `.env` → reinicia el agente: Programador de tareas → clic derecho en la tarea → **Finalizar** y luego **Ejecutar**.
- Nueva versión del agente: sustituye los archivos `.py` (no toques `.env`) y reinicia la tarea.

## Desinstalar

1. Programador de tareas → clic derecho en la tarea → **Eliminar** (o en PowerShell:
   `Unregister-ScheduledTask -TaskName "Automatizacion con IA - Agente" -Confirm:$false`).
2. Borra la carpeta `C:\AutomatizacionIA`.
3. En la web, **Agente local → Eliminar**: el token deja de funcionar al instante.

## Pruebas del propio agente (opcional)

```bat
cd C:\AutomatizacionIA\agent
.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Incluyen una prueba completa con un «Supabase» falso, Watchdog real y archivos reales.


---

## Correos con tu Outlook (opcional)

Las reglas pueden enviar un correo con datos del Excel. **Por defecto el agente NO envía nada** (`EMAIL_MODE=off`):
los correos aparecen en el Dashboard como «Tienes pendiente mandar el correo…» y los envías tú.

Para que el agente los gestione con el Outlook de escritorio de tu PC (Windows, Outlook clásico abierto y con sesión):

1. Instala la pieza extra (una vez): `.venv\Scripts\python.exe -m pip install -r requirements.txt` (incluye `pywin32`).
2. En `.env` elige un modo:
   - `EMAIL_MODE=draft` → los deja en **Borradores** de Outlook; los revisas y envías tú. *(Recomendado para empezar.)*
   - `EMAIL_MODE=send` → los **envía** solo, pero únicamente a los dominios de `EMAIL_ALLOWED_DOMAINS=miempresa.com` (obligatorio) y con tope `EMAIL_MAX_PER_HOUR` (20 por defecto).
3. Reinicia el agente y ejecuta `comprobar_agente.bat`: debe decir «Correos: modo …».

**Varias cuentas en Outlook.** Añade a `.env` `OUTLOOK_ACCOUNT_EMAIL=tu_cuenta@dominio.com`: los borradores se crean en la carpeta Borradores de ESA cuenta (y los envíos salen desde ella). Si una regla indica su propio remitente, manda el de la regla. `comprobar_agente.bat` lista las cuentas de tu Outlook.

**Copia (CC).** Al crear la regla puedes indicar destinatarios en copia (fijos o con `{col:Columna}`). En modo `send`, la copia también debe estar en `EMAIL_ALLOWED_DOMAINS`.

**Alertas por fecha.** Para columnas de fecha hay dos opciones nuevas: «ha pasado al menos N días/semanas/meses/años» y «ya llegó la fecha elegida». Dependen del día de hoy: el agente reevalúa esas reglas una vez al día aunque el archivo no cambie (con la fecha de tu ordenador).

**Vista previa y abrir carpeta desde la web.** Añade a `.env` `WEB_ORIGIN=https://tu-app.vercel.app`. El agente abre un servidor solo en `127.0.0.1:47821` que únicamente responde a esa web. Funciona con Chrome/Edge en este mismo ordenador (Safari bloquea este tipo de conexión).

Seguridad: el contenido de una celda de Excel acaba en el correo. Por eso en modo `send` solo se envía a dominios que tú autorizas. Un correo con destinatario no válido o fuera de esos dominios queda pendiente en la web con el motivo. Si el remitente de la regla no coincide con una cuenta de tu Outlook, también queda pendiente.
