"""Carga de configuración desde el archivo .env (junto al agente) y variables de entorno."""
from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

HERE = Path(__file__).resolve().parent


class ConfigError(Exception):
    pass


def _parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key.strip()] = value
    return values


@dataclass(frozen=True)
class Config:
    supabase_url: str
    anon_key: str
    token: str
    folders: tuple[Path, ...]
    poll_seconds: int
    debounce_seconds: float
    max_file_bytes: int
    base_dir: Path
    # Envío de correos con tu Outlook. Por defecto DESACTIVADO: los correos quedan «pendientes» en la web.
    email_mode: str = "off"            # off | draft (los deja en Borradores) | send (los envía)
    email_allowed_domains: tuple[str, ...] = ()
    email_max_per_hour: int = 20
    # Cuenta de Outlook (su dirección) donde se crean los borradores / desde la que se envía, si tienes varias.
    outlook_account: str = ""
    # Direcciones de la web que pueden pedir la vista previa / abrir archivos de este PC (WEB_ORIGIN).
    web_origins: tuple[str, ...] = ()
    # Carpeta donde se guardan los informes rellenados («Rellenar»). Por defecto: Documentos/AutomatizaIA.
    fill_dir: Optional[Path] = None

    @property
    def state_file(self) -> Path:
        return self.base_dir / "state.json"

    @property
    def log_file(self) -> Path:
        return self.base_dir / "agent.log"


def load_config(base_dir: Path = HERE) -> Config:
    env = {**_parse_env_file(base_dir / ".env"), **{k: v for k, v in os.environ.items() if k.startswith(("SUPABASE_", "AGENT_", "WATCH_", "POLL_", "DEBOUNCE_", "MAX_FILE", "EMAIL_", "OUTLOOK_", "WEB_"))}}

    missing = [k for k in ("SUPABASE_URL", "SUPABASE_ANON_KEY", "AGENT_TOKEN", "WATCH_FOLDERS") if not env.get(k)]
    if missing:
        raise ConfigError(
            "Faltan valores en el archivo .env: " + ", ".join(missing) + ". Copia .env.example como .env y rellénalo."
        )

    url = env["SUPABASE_URL"].rstrip("/")
    if not (url.startswith("https://") or url.startswith(("http://localhost", "http://127.0.0.1"))):
        raise ConfigError("SUPABASE_URL debe empezar por https://")

    folders: list[Path] = []
    for part in env["WATCH_FOLDERS"].split(";"):
        part = part.strip().strip('"')
        if not part:
            continue
        p = Path(part).expanduser()
        if not p.is_dir():
            raise ConfigError(f"La carpeta de WATCH_FOLDERS no existe: {part}")
        folders.append(p.resolve())
    if not folders:
        raise ConfigError("WATCH_FOLDERS no contiene ninguna carpeta.")

    def number(key: str, default: float, minimum: float) -> float:
        try:
            return max(minimum, float(env.get(key, default)))
        except ValueError as e:
            raise ConfigError(f"{key} debe ser un número.") from e

    email_mode = env.get("EMAIL_MODE", "off").strip().lower() or "off"
    if email_mode not in ("off", "draft", "send"):
        raise ConfigError("EMAIL_MODE debe ser off, draft o send.")
    domains = tuple(d.strip().lower().lstrip("@") for d in env.get("EMAIL_ALLOWED_DOMAINS", "").split(",") if d.strip())
    if email_mode == "send" and not domains:
        raise ConfigError(
            "Con EMAIL_MODE=send hay que indicar EMAIL_ALLOWED_DOMAINS (p. ej. miempresa.com): "
            "solo se enviará automáticamente a esos dominios."
        )

    outlook_account = env.get("OUTLOOK_ACCOUNT_EMAIL", "").strip()
    if outlook_account and not re.match(r"^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$", outlook_account):
        raise ConfigError("OUTLOOK_ACCOUNT_EMAIL debe ser una dirección de correo (p. ej. nombre@empresa.com).")

    origins: list[str] = []
    for o in env.get("WEB_ORIGIN", "").split(","):
        o = o.strip().rstrip("/")
        if not o:
            continue
        if not re.fullmatch(r"https://[A-Za-z0-9.-]+(:[0-9]+)?|http://(localhost|127\.0\.0\.1)(:[0-9]+)?", o):
            raise ConfigError("WEB_ORIGIN debe ser la dirección de tu web sin nada más, p. ej. https://miapp.vercel.app")
        origins.append(o)

    fill_raw = env.get("FILL_DIR", "").strip()
    fill_dir = Path(fill_raw).expanduser() if fill_raw else Path.home() / "Documents" / "AutomatizaIA"

    return Config(
        supabase_url=url,
        anon_key=env["SUPABASE_ANON_KEY"],
        token=env["AGENT_TOKEN"],
        folders=tuple(folders),
        poll_seconds=int(number("POLL_SECONDS", 30, 10)),
        debounce_seconds=number("DEBOUNCE_SECONDS", 3, 1),
        max_file_bytes=int(number("MAX_FILE_MB", 50, 1) * 1024 * 1024),
        base_dir=base_dir,
        email_mode=email_mode,
        email_allowed_domains=domains,
        email_max_per_hour=int(number("EMAIL_MAX_PER_HOUR", 20, 1)),
        outlook_account=outlook_account,
        web_origins=tuple(origins),
        fill_dir=fill_dir,
    )
