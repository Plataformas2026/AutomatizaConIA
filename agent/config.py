"""Carga de configuración desde el archivo .env (junto al agente) y variables de entorno."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

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

    @property
    def state_file(self) -> Path:
        return self.base_dir / "state.json"

    @property
    def log_file(self) -> Path:
        return self.base_dir / "agent.log"


def load_config(base_dir: Path = HERE) -> Config:
    env = {**_parse_env_file(base_dir / ".env"), **{k: v for k, v in os.environ.items() if k.startswith(("SUPABASE_", "AGENT_", "WATCH_", "POLL_", "DEBOUNCE_", "MAX_FILE"))}}

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

    return Config(
        supabase_url=url,
        anon_key=env["SUPABASE_ANON_KEY"],
        token=env["AGENT_TOKEN"],
        folders=tuple(folders),
        poll_seconds=int(number("POLL_SECONDS", 30, 10)),
        debounce_seconds=number("DEBOUNCE_SECONDS", 3, 1),
        max_file_bytes=int(number("MAX_FILE_MB", 50, 1) * 1024 * 1024),
        base_dir=base_dir,
    )
