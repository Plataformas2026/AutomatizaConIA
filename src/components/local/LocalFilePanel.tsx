'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AGENT_ERRORS, extensionOf, LOCAL_MIME_BY_EXT, type AgentCard } from '@/lib/agents/types';
import { IconUpload } from '../Icons';

interface Picked {
  name: string;
  path: string;
}

/**
 * Elegir archivos de TU ordenador para vigilarlos. IMPORTANTE: el navegador NO sube nada:
 * solo lee el NOMBRE de cada archivo. Quien lo lee y vigila es el agente instalado en tu PC.
 */
export function LocalFilePanel({ agents, projectId = null }: { agents: AgentCard[]; projectId?: string | null }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [over, setOver] = useState(false);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [agentId, setAgentId] = useState(agents[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const agent = agents.find((a) => a.id === agentId) ?? agents[0];

  function receive(list: FileList | File[]) {
    const files = Array.from(list);
    if (!files.length) return;
    const ok: Picked[] = [];
    const bad: string[] = [];
    for (const f of files) {
      if (LOCAL_MIME_BY_EXT[extensionOf(f.name)]) ok.push({ name: f.name, path: '' });
      else bad.push(f.name);
    }
    setRejected(bad);
    setResult(null);
    setError(null);
    if (!ok.length) return;
    setPicked(ok);
    dialogRef.current?.showModal();
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/local-files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId,
        projectId,
        files: picked.map((p) => ({ name: p.name, path: p.path.trim() || null })),
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(AGENT_ERRORS[body.error] ?? AGENT_ERRORS.db_error);
      return;
    }
    const parts: string[] = [];
    if (body.added) parts.push(body.added === 1 ? '1 archivo añadido.' : `${body.added} archivos añadidos.`);
    if (body.duplicates?.length) parts.push(`Ya estaban añadidos: ${body.duplicates.join(', ')}.`);
    if (body.invalid?.length) parts.push(`No válidos (revisa nombre y ruta): ${body.invalid.join(', ')}.`);
    setResult(parts.join(' '));
    dialogRef.current?.close();
    setPicked([]);
    router.refresh();
  }

  if (!agents.length) {
    return (
      <div className="row wrap">
        <div className="grow">
          <strong>Vigilar archivos de tu ordenador</strong>
          <div className="muted">
            Tus archivos locales no salen de tu PC. Para vigilarlos instalas un pequeño programa (el agente) que los
            lee en tu ordenador y solo envía los avisos.
          </div>
        </div>
        <Link className="btn primary" href="/agent">
          <IconUpload size={16} /> Configurar el agente local
        </Link>
      </div>
    );
  }

  return (
    <div className="intake">
      <div
        className={`dropzone ${over ? 'is-over' : ''}`}
        onDragEnter={(e) => e.dataTransfer.types.includes('Files') && setOver(true)}
        onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          setOver(false);
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          receive(e.dataTransfer.files);
        }}
      >
        <div className="grow">
          <strong>Vigilar archivos de tu ordenador</strong>
          <div className="muted">
            Elige uno o varios Excel/CSV (o arrástralos aquí). <strong>No se suben a ninguna parte</strong>: solo se
            guarda su nombre y el agente de tu PC los vigila.
          </div>
          <div className="agent-line">
            {agents.map((a) => (
              <span key={a.id} className={`agent-pill ${a.online ? 'is-online' : ''}`}>
                <span className="agent-dot" aria-hidden="true" />
                {a.name}: {a.online ? 'conectado' : `sin conexión (${a.lastSeenLabel})`}
              </span>
            ))}
            <Link href="/agent" className="linkbtn">
              Gestionar agentes
            </Link>
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".xlsx,.xlsm,.xls,.csv"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            const list = e.target.files ? Array.from(e.target.files) : [];
            e.target.value = '';
            receive(list);
          }}
        />
        <button type="button" className="btn primary" onClick={() => inputRef.current?.click()}>
          <IconUpload size={16} /> Elegir archivos
        </button>
      </div>

      {rejected.length > 0 && (
        <div className="err">Solo se admiten .xlsx, .xlsm, .xls y .csv. Ignorados: {rejected.join(', ')}.</div>
      )}
      {result && (
        <div className="ok" role="status">
          {result}
        </div>
      )}

      <dialog ref={dialogRef} className="dialog dialog-wide-ish" onClose={() => setPicked([])} aria-labelledby="local-dialog-title">
        <h2 id="local-dialog-title">{picked.length === 1 ? 'Vigilar este archivo' : `Vigilar ${picked.length} archivos`}</h2>
        <p className="muted">
          Los archivos <strong>permanecen en tu ordenador</strong>. El agente los buscará por su nombre dentro de las
          carpetas que autorizaste al instalarlo.
        </p>

        {agents.length > 1 && (
          <div className="field">
            <label htmlFor="local-agent">¿Qué ordenador (agente) los vigilará?</label>
            <select id="local-agent" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {agent && !agent.online && (
          <p className="notice notice-warn">
            «{agent.name}» no está conectado ahora. Los archivos empezarán a vigilarse cuando el agente se inicie.
          </p>
        )}

        <ul className="picked-list">
          {picked.map((p, i) => (
            <li key={p.name}>
              <strong className="picked-name">{p.name}</strong>
              <label className="sr-only" htmlFor={`path-${i}`}>
                Ruta completa de {p.name} (opcional)
              </label>
              <input
                id={`path-${i}`}
                value={p.path}
                onChange={(e) => setPicked((cur) => cur.map((x, j) => (j === i ? { ...x, path: e.target.value } : x)))}
                placeholder={`Ruta completa (opcional) · C:\\Users\\…\\${p.name}`}
                maxLength={500}
                spellCheck={false}
              />
            </li>
          ))}
        </ul>
        <p className="muted">
          <strong>La ruta es opcional.</strong> Sin ella, el agente busca el archivo por nombre. Si tienes dos archivos
          con el mismo nombre, pega la ruta completa (en el Explorador: Mayús + clic derecho → «Copiar como ruta de
          acceso»).
        </p>

        {error && <p className="err" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => dialogRef.current?.close()}>
            Cancelar
          </button>
          <button type="button" className="btn primary" onClick={confirm} disabled={busy || !agentId}>
            {busy ? 'Guardando…' : 'Empezar a vigilar'}
          </button>
        </div>
      </dialog>
    </div>
  );
}
