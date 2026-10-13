'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  fileId: string;
  fileName: string;
  initialPath: string | null;
  agentName: string | null;
  agentOnline: boolean;
}

/** Panel de un archivo local: quién lo vigila y su ruta (opcional). */
export function LocalFileInfo({ fileId, fileName, initialPath, agentName, agentOnline }: Props) {
  const router = useRouter();
  const [path, setPath] = useState(initialPath ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function save() {
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/local-files/${fileId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: path.trim() || null }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setMessage({ text: 'Guardado. El agente lo recogerá en menos de un minuto.', error: false });
      router.refresh();
    } else {
      setMessage({
        text:
          body.error === 'path_mismatch'
            ? `La ruta debe terminar en el nombre del archivo: «${fileName}».`
            : 'No se pudo guardar la ruta.',
        error: true,
      });
    }
  }

  return (
    <section className="panel" aria-labelledby="local-info-title">
      <h2 id="local-info-title">Archivo en tu ordenador</h2>
      <p className="muted">
        Este archivo <strong>no está en la nube</strong>: lo vigila el agente de tu PC.{' '}
        {agentName ? (
          <>
            Agente: <strong>{agentName}</strong> ({agentOnline ? 'conectado' : 'sin conexión ahora'}).
          </>
        ) : (
          <span className="err">Este archivo no tiene agente asignado: añádelo de nuevo desde el Dashboard.</span>
        )}
      </p>
      <div className="field">
        <label htmlFor="local-path">Ruta completa (opcional)</label>
        <div className="row wrap">
          <input
            id="local-path"
            className="grow"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder={`C:\\Users\\…\\${fileName}`}
            maxLength={500}
            spellCheck={false}
          />
          <button type="button" className="btn" onClick={save} disabled={busy || path.trim() === (initialPath ?? '')}>
            {busy ? 'Guardando…' : 'Guardar ruta'}
          </button>
        </div>
        <span className="muted">
          Si la dejas vacía, el agente busca «{fileName}» por nombre en las carpetas que autorizaste. Debe estar dentro
          de esas carpetas.
        </span>
        {message && <p className={message.error ? 'err' : 'ok'}>{message.text}</p>}
      </div>
    </section>
  );
}
