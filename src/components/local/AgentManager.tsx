'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AGENT_ERRORS, type AgentCard } from '@/lib/agents/types';
import { IconTrash } from '../Icons';

interface Props {
  agents: AgentCard[];
  supabaseUrl: string;
  anonKey: string;
}

/** Crear y quitar agentes. El token se muestra UNA vez, al crear el agente. */
export function AgentManager({ agents, supabaseUrl, anonKey }: Props) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(AGENT_ERRORS[body.error] ?? AGENT_ERRORS.db_error);
      return;
    }
    setCreated({ name: name.trim(), token: body.token });
    setName('');
    setCopied(false);
    router.refresh();
  }

  async function remove(a: AgentCard) {
    const msg =
      a.fileCount > 0
        ? `¿Eliminar «${a.name}»? Sus ${a.fileCount} archivo(s) seguirán en la lista pero dejarán de vigilarse. Tus archivos del ordenador no se tocan.`
        : `¿Eliminar «${a.name}»? Su token dejará de funcionar.`;
    if (!confirm(msg)) return;
    const res = await fetch(`/api/agents/${a.id}`, { method: 'DELETE' });
    if (res.ok) router.refresh();
  }

  const envText = created
    ? [
        '# Agente: ' + created.name,
        `SUPABASE_URL=${supabaseUrl}`,
        `SUPABASE_ANON_KEY=${anonKey}`,
        `AGENT_TOKEN=${created.token}`,
        '# Carpetas que el agente PUEDE leer (separadas por punto y coma):',
        'WATCH_FOLDERS=C:\\Users\\TU_USUARIO\\Documents',
      ].join('\n')
    : '';

  return (
    <>
      {created && (
        <section className="panel token-box" aria-labelledby="token-title">
          <h2 id="token-title">Agente «{created.name}» creado</h2>
          <p className="notice notice-warn">
            <strong>Copia esto ahora.</strong> El token solo se muestra una vez; si lo pierdes, borra este agente y crea
            otro.
          </p>
          <p className="muted">
            Guárdalo como <code>.env</code> dentro de la carpeta del agente y cambia <code>WATCH_FOLDERS</code> por las
            carpetas donde están tus archivos.
          </p>
          <pre className="env-block" tabIndex={0}>{envText}</pre>
          <div className="row wrap">
            <button
              type="button"
              className="btn primary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(envText);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? 'Copiado ✓' : 'Copiar'}
            </button>
            <button type="button" className="btn" onClick={() => setCreated(null)}>
              Ya lo he guardado
            </button>
          </div>
        </section>
      )}

      <section className="panel" aria-labelledby="agents-title">
        <h2 id="agents-title">Tus agentes</h2>
        {!agents.length && <p className="muted">Todavía no has creado ningún agente.</p>}
        <ul className="agent-list">
          {agents.map((a) => (
            <li key={a.id} className="agent-row">
              <span className={`agent-dot ${a.online ? 'is-online' : ''}`} aria-hidden="true" />
              <div className="grow">
                <strong>{a.name}</strong>{' '}
                <span className={`pill ${a.online ? 'active' : 'paused'}`}>{a.online ? 'Conectado' : 'Sin conexión'}</span>
                <div className="muted">
                  Última señal: {a.lastSeenLabel}
                  {a.version ? ` · versión ${a.version}` : ''} ·{' '}
                  {a.fileCount === 1 ? '1 archivo' : `${a.fileCount} archivos`}
                </div>
              </div>
              <button type="button" className="btn danger" onClick={() => void remove(a)}>
                <IconTrash size={16} /> Eliminar
              </button>
            </li>
          ))}
        </ul>

        <form className="agent-form" onSubmit={create}>
          <label htmlFor="agent-name">Nombre del ordenador</label>
          <div className="row wrap">
            <input
              id="agent-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Por ejemplo: PC de la oficina"
              maxLength={60}
              required
              className="grow"
            />
            <button type="submit" className="btn primary" disabled={busy || !name.trim()}>
              {busy ? 'Creando…' : 'Crear agente'}
            </button>
          </div>
          {error && <p className="err" role="alert">{error}</p>}
        </form>
      </section>
    </>
  );
}
