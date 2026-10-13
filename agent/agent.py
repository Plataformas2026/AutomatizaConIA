#!/usr/bin/env python3
"""
Agente local de «Automatización con IA».

Vigila archivos Excel/CSV de ESTE ordenador con Watchdog, aplica tus reglas y envía a Supabase
solo los resultados (avisos con nº de fila, nombres de hojas/columnas y el estado).
El contenido del archivo no sale del PC.

Uso:
    python agent.py            # arranca el agente (se queda en marcha)
    python agent.py --check    # comprueba la configuración y la conexión, sin cambiar nada
    python agent.py --once     # evalúa todos los archivos una vez y termina
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import logging.handlers
import os
import queue
import socket
import sys
import threading
import time
from pathlib import Path
from typing import Optional

from api import Api, ApiError, ApiUnavailable, TokenError
from config import Config, ConfigError, load_config
import engine
import readers

VERSION = "1.0.0"
LOCK_PORT = 47653  # evita dos agentes a la vez (se libera sola al cerrar)
log = logging.getLogger("agente")

NOT_FOUND = "No se encuentra «{name}» en las carpetas autorizadas (WATCH_FOLDERS)."
AMBIGUOUS = "Hay {n} archivos llamados «{name}» en las carpetas autorizadas. Indica la ruta completa en la web."
OUTSIDE = "La ruta indicada no está dentro de las carpetas autorizadas (WATCH_FOLDERS)."
BAD_PATH = "La ruta indicada no existe o no es un archivo."
BAD_TYPE = "Tipo de archivo no admitido (solo .xlsx, .xlsm, .xls y .csv)."
TOO_BIG = "El archivo supera el tamaño máximo permitido (MAX_FILE_MB)."
BUSY = "El archivo está bloqueado por otro programa. Se reintentará."
SHEETS_GONE = "Las hojas seleccionadas ya no existen en el archivo. Elige otras en «Hojas vigiladas»."
SKIP_DIRS = {"node_modules", "appdata", "$recycle.bin", "system volume information", "windows", "program files", "program files (x86)"}


def norm(p: Path | str) -> str:
    return os.path.normcase(os.path.abspath(str(p)))


def inside(path: Path, folders: tuple[Path, ...]) -> bool:
    target = norm(path.resolve())
    for f in folders:
        base = norm(f)
        try:
            if os.path.commonpath([target, base]) == base:
                return True
        except ValueError:  # unidades distintas en Windows
            continue
    return False


class State:
    """Qué versión de cada archivo ya se evaluó. Solo huellas y marcas de tiempo, nunca datos."""

    def __init__(self, path: Path):
        self.path = path
        self.data: dict[str, dict] = {}
        try:
            self.data = json.loads(path.read_text(encoding="utf-8")).get("files", {})
        except (OSError, ValueError):
            self.data = {}

    def get(self, fid: str) -> dict:
        return self.data.setdefault(fid, {})

    def save(self) -> None:
        tmp = self.path.with_suffix(".tmp")
        try:
            tmp.write_text(json.dumps({"files": self.data}), encoding="utf-8")
            os.replace(tmp, self.path)
        except OSError:
            log.warning("No se pudo guardar state.json")


class Agent:
    def __init__(self, cfg: Config, api: Api):
        self.cfg = cfg
        self.api = api
        self.state = State(cfg.state_file)
        self.files: dict[str, dict] = {}        # id → configuración de la web
        self.paths: dict[str, Path] = {}        # id → ruta resuelta
        self.path_index: dict[str, set[str]] = {}  # ruta normalizada → ids
        self.events: "queue.Queue[str]" = queue.Queue()
        self.due: dict[str, float] = {}         # id → cuándo evaluar (antidemora)
        self.observer = None
        self.watched: set[str] = set()
        self._name_index: Optional[dict[str, list[Path]]] = None
        self._name_index_at = 0.0
        self._offline = False
        self.stop = threading.Event()

    # ── Resolución de rutas ─────────────────────────────────────────────
    def _scan_names(self) -> dict[str, list[Path]]:
        if self._name_index is not None and time.monotonic() - self._name_index_at < 300:
            return self._name_index
        index: dict[str, list[Path]] = {}
        count = 0
        for root in self.cfg.folders:
            for dirpath, dirnames, filenames in os.walk(root):
                depth = len(Path(dirpath).relative_to(root).parts)
                dirnames[:] = [d for d in dirnames if not d.startswith(".") and d.lower() not in SKIP_DIRS] if depth < 8 else []
                for fn in filenames:
                    count += 1
                    if count > 300_000:
                        break
                    if fn.lower().endswith(readers.SUPPORTED_EXTS) and not fn.startswith("~$"):
                        index.setdefault(fn.lower(), []).append(Path(dirpath) / fn)
        self._name_index, self._name_index_at = index, time.monotonic()
        return index

    def resolve(self, f: dict) -> tuple[Optional[Path], Optional[str]]:
        name, given = f["name"], f.get("path")
        if given:
            p = Path(given).expanduser()
            if not p.is_file():
                return None, BAD_PATH
            if not inside(p, self.cfg.folders):
                return None, OUTSIDE
            if p.suffix.lower() not in readers.SUPPORTED_EXTS:
                return None, BAD_TYPE
            return p.resolve(), None

        cached = self.paths.get(f["id"])
        if cached and cached.is_file():
            return cached, None
        found = self._scan_names().get(name.lower(), [])
        found = [p for p in found if p.is_file()]
        if not found:
            self._name_index = None  # que el próximo intento vuelva a mirar el disco
            return None, NOT_FOUND.format(name=name)
        if len(found) > 1:
            return None, AMBIGUOUS.format(n=len(found), name=name)
        return found[0].resolve(), None

    # ── Watchdog ────────────────────────────────────────────────────────
    def _start_observer(self) -> None:
        from watchdog.events import FileSystemEventHandler
        from watchdog.observers import Observer

        events = self.events

        class Handler(FileSystemEventHandler):
            def on_any_event(self, event):  # noqa: N802 (API de watchdog)
                # Solo cambios reales: leer el archivo también genera eventos «opened/closed» en Linux/macOS.
                if event.is_directory or event.event_type not in ("modified", "created", "moved"):
                    return
                for attr in ("src_path", "dest_path"):
                    p = getattr(event, attr, None)
                    if p:
                        events.put(norm(os.fsdecode(p)))

        self._handler = Handler()
        self.observer = Observer()
        self.observer.start()

    def _sync_watches(self) -> None:
        """Vigila la carpeta de cada archivo (no recursivo). Solo las rutas ya resueltas."""
        if self.observer is None:
            return
        wanted = {norm(p.parent) for p in self.paths.values()}
        for d in wanted - self.watched:
            try:
                self.observer.schedule(self._handler, d, recursive=False)
                self.watched.add(d)
                log.info("Vigilando la carpeta %s", d)
            except OSError:
                log.warning("No se pudo vigilar la carpeta %s", d)
        # Las carpetas que ya no hacen falta se dejan: es barato y evita reinicios del observador.

    # ── Configuración ───────────────────────────────────────────────────
    def refresh(self) -> None:
        cfg = self.api.get_config()
        self.files = {f["id"]: f for f in cfg.get("files", [])}
        self.paths = {}
        self.path_index = {}
        for fid, f in self.files.items():
            path, err = self.resolve(f)
            if path:
                self.paths[fid] = path
                self.path_index.setdefault(norm(path), set()).add(fid)
            f["_resolve_error"] = err
        self._sync_watches()

        for fid in list(self.state.data):
            if fid not in self.files:
                del self.state.data[fid]

        now = time.monotonic()
        for fid, f in self.files.items():
            if fid in self.due:
                continue
            if self._needs_evaluation(fid, f):
                self.due[fid] = now

    def _cfg_sig(self, f: dict) -> str:
        parts = [f["name"], f.get("path") or "", f.get("sheet_mode"), sorted(f.get("sheet_names") or []),
                 [(r["id"], r.get("updated_at")) for r in f.get("rules", [])]]
        return hashlib.sha256(json.dumps(parts, sort_keys=True, default=str).encode()).hexdigest()[:16]

    def _needs_evaluation(self, fid: str, f: dict) -> bool:
        st = self.state.get(fid)
        err = f.get("_resolve_error")
        if err:
            return st.get("reported_error") != err
        if st.get("cfg_sig") != self._cfg_sig(f) or "hash" not in st:
            return True
        if st.get("reported_error"):  # se arregló la ruta/bloqueo: volver a evaluar
            return True
        if not f.get("has_structure") and time.monotonic() - st.get("structure_try", 0) > 45:
            return True
        try:
            stat = self.paths[fid].stat()
        except OSError:
            return True
        return (stat.st_mtime_ns, stat.st_size) != (st.get("mtime_ns"), st.get("size"))

    # ── Evaluación ──────────────────────────────────────────────────────
    def _read(self, path: Path) -> bytes:
        last: Exception | None = None
        for _ in range(8):
            try:
                if path.stat().st_size > self.cfg.max_file_bytes:
                    raise OverflowError
                with open(path, "rb") as fh:
                    return fh.read()
            except OverflowError:
                raise
            except (PermissionError, FileNotFoundError, OSError) as e:  # Excel guardando / archivo bloqueado
                last = e
                time.sleep(1.0)
        raise last or OSError

    def evaluate(self, fid: str, force: bool = False) -> None:
        f = self.files.get(fid)
        if not f:
            return
        st = self.state.get(fid)
        name = f["name"]

        err = f.get("_resolve_error")
        if err or fid not in self.paths:
            self._report_error(fid, err or NOT_FOUND.format(name=name), st)
            return

        path = self.paths[fid]
        try:
            data = self._read(path)
        except OverflowError:
            self._report_error(fid, TOO_BIG, st)
            return
        except OSError:
            self._report_error(fid, BUSY, st)
            self.due[fid] = time.monotonic() + self.cfg.poll_seconds
            return

        digest = hashlib.sha256(data).hexdigest()
        stat = path.stat()
        sig = self._cfg_sig(f)
        unchanged = st.get("hash") == digest and st.get("cfg_sig") == sig and f.get("has_structure") and not st.get("reported_error")
        if unchanged and not force:
            st.update(mtime_ns=stat.st_mtime_ns, size=stat.st_size)
            self.state.save()
            return

        try:
            wb = readers.read_workbook(data, path.suffix, f.get("sheet_mode") or "first", f.get("sheet_names") or [])
        except readers.ReadError as e:
            self._report_error(fid, str(e), st)
            return
        except Exception as e:  # nunca registrar el mensaje: podría citar datos
            log.error("Error al leer «%s»: %s", name, type(e).__name__)
            self._report_error(fid, "No se pudo leer el archivo.", st)
            return
        finally:
            del data  # el contenido no se conserva

        rules = f.get("rules", [])
        sheets_error = SHEETS_GONE if rules and not wb.sheets and wb.available else None
        self.api.report_file(fid, "active", sheets_error, digest[:16], wb.structure)
        f["has_structure"] = True

        new_alerts = 0
        for raw in rules:
            rule = engine.validate_rule(raw)
            if rule is None:
                self.api.report_rule(fid, str(raw.get("id")), None, "Regla no válida", None)
                continue
            ev = engine.evaluate_across_sheets(rule, wb.sheets)
            if ev.error:
                self.api.report_rule(fid, rule.id, None, ev.error, None)
                continue
            previous = raw.get("fingerprints") or {}
            fingerprints, alerts = engine.build_alerts(rule, ev, previous, name)
            self.api.report_rule(fid, rule.id, fingerprints, None, alerts)
            raw["fingerprints"] = fingerprints  # por si se reevalúa antes de la próxima sincronización
            new_alerts += len(alerts)

        st.update(hash=digest, cfg_sig=sig, mtime_ns=stat.st_mtime_ns, size=stat.st_size,
                  structure_try=time.monotonic())
        st.pop("reported_error", None)
        self.state.save()
        log.info("«%s»: %d regla(s) evaluadas, %d alerta(s) nueva(s)", name, len(rules), new_alerts)

    def _report_error(self, fid: str, message: str, st: dict) -> None:
        if st.get("reported_error") != message:
            self.api.report_file(fid, "error", message, None, None)
            log.warning("«%s»: %s", self.files[fid]["name"], message)
        st["reported_error"] = message
        self.state.save()

    # ── Bucle principal ─────────────────────────────────────────────────
    def _drain_events(self) -> None:
        now = time.monotonic()
        while True:
            try:
                p = self.events.get_nowait()
            except queue.Empty:
                return
            for fid in self.path_index.get(p, ()):
                self.due[fid] = now + self.cfg.debounce_seconds  # espera a que termine de guardar

    def _run_due(self) -> None:
        now = time.monotonic()
        for fid in [i for i, t in self.due.items() if t <= now]:
            del self.due[fid]
            try:
                self.evaluate(fid)
            except ApiUnavailable:
                raise
            except TokenError:
                raise
            except ApiError as e:
                log.error("Supabase rechazó la petición: %s", e)
            except Exception as e:
                log.error("Error inesperado con un archivo: %s", type(e).__name__)

    def run(self) -> int:
        self._start_observer()
        next_poll = 0.0
        log.info("Agente %s en marcha. Carpetas autorizadas: %s", VERSION, "; ".join(str(f) for f in self.cfg.folders))
        try:
            while not self.stop.is_set():
                now = time.monotonic()
                try:
                    if now >= next_poll:
                        self.refresh()
                        next_poll = now + self.cfg.poll_seconds
                        if self._offline:
                            log.info("Conexión recuperada.")
                            self._offline = False
                    self._drain_events()
                    self._run_due()
                except ApiUnavailable as e:
                    if not self._offline:
                        log.warning("Sin conexión con Supabase (%s). Se reintentará.", e)
                        self._offline = True
                    next_poll = time.monotonic() + self.cfg.poll_seconds
                    for fid in self.files:  # reintentar lo pendiente tras reconectar
                        self.due.setdefault(fid, next_poll)
                except TokenError:
                    log.error("El token del agente no es válido o se eliminó en la web. Revisa AGENT_TOKEN en .env.")
                    self.stop.wait(600)
                    return 2
                except ApiError as e:
                    log.error("%s", e)
                    next_poll = time.monotonic() + self.cfg.poll_seconds
                self.stop.wait(0.5)
        finally:
            if self.observer:
                self.observer.stop()
                self.observer.join(timeout=5)
        return 0

    def run_once(self) -> int:
        self.refresh()
        for fid in list(self.files):
            self.evaluate(fid, force=True)
        return 0


# ── Utilidades de arranque ──────────────────────────────────────────────
def setup_logging(cfg: Config, verbose: bool) -> None:
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s", "%Y-%m-%d %H:%M:%S")
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    fh = logging.handlers.RotatingFileHandler(cfg.log_file, maxBytes=1_000_000, backupCount=3, encoding="utf-8")
    fh.setFormatter(fmt)
    root.addHandler(fh)
    if sys.stdout is not None and (verbose or sys.stdout.isatty()):
        sh = logging.StreamHandler(sys.stdout)
        sh.setFormatter(fmt)
        root.addHandler(sh)


def single_instance() -> Optional[socket.socket]:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", LOCK_PORT))
        s.listen(1)
        return s
    except OSError:
        return None


def check(cfg: Config, api: Api) -> int:
    print(f"Agente {VERSION}")
    print("Carpetas autorizadas:")
    for f in cfg.folders:
        print(f"  ✓ {f}")
    try:
        conf = api.get_config()
    except TokenError:
        print("✗ El token no es válido (¿se eliminó el agente en la web o está mal copiado?).")
        return 2
    except ApiUnavailable as e:
        print(f"✗ No hay conexión con Supabase ({e}).")
        return 3
    except ApiError as e:
        print(f"✗ {e}")
        return 3
    print(f"✓ Conexión con Supabase correcta. Agente: «{conf['agent']['name']}»")
    agent = Agent(cfg, api)
    files = conf.get("files", [])
    print(f"Archivos asignados: {len(files)}")
    for f in files:
        path, err = agent.resolve(f)
        print(f"  {'✓' if path else '✗'} {f['name']}  →  {path if path else err}   ({len(f.get('rules', []))} regla(s))")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Agente local de Automatización con IA")
    ap.add_argument("--check", action="store_true", help="comprueba configuración y conexión")
    ap.add_argument("--once", action="store_true", help="evalúa una vez y termina")
    ap.add_argument("--version", action="store_true")
    ap.add_argument("-v", "--verbose", action="store_true", help="muestra el registro en pantalla")
    args = ap.parse_args()
    if args.version:
        print(VERSION)
        return 0

    try:
        cfg = load_config()
    except ConfigError as e:
        print(f"Error de configuración: {e}")
        return 1
    setup_logging(cfg, args.verbose or args.check or args.once)
    api = Api(cfg.supabase_url, cfg.anon_key, cfg.token, VERSION)

    if args.check:
        return check(cfg, api)

    lock = single_instance()
    if lock is None:
        print("Ya hay otro agente en marcha en este ordenador.")
        return 0

    agent = Agent(cfg, api)
    try:
        if args.once:
            return agent.run_once()
        return agent.run()
    except KeyboardInterrupt:
        log.info("Agente detenido.")
        return 0
    except TokenError:
        log.error("El token del agente no es válido.")
        return 2
    except ApiUnavailable as e:
        log.error("Sin conexión con Supabase (%s).", e)
        return 3


if __name__ == "__main__":
    sys.exit(main())
