'use client';

import { useEffect, useRef, useState } from 'react';
import { localFill, LocalAgentError, LOCAL_ERROR_TEXT } from '@/lib/agents/local-api';
import type { AlertRow } from '../AlertsProvider';

const FILL_ERRORS: Record<string, string> = {
  not_found: 'Esta alerta ya no está disponible.',
  row_not_in_alert: 'Esa fila no forma parte de la alerta.',
  row_not_found: 'Esa fila ya no existe en el archivo. Espera a la próxima comprobación.',
  template_not_found: 'La plantilla ya no existe. Avisa al administrador.',
  bad_template: 'La plantilla no se puede abrir como documento Word. Avisa al administrador.',
  google_not_connected: 'Google Drive está desconectado: hay que volver a conectarlo para leer el archivo.',
  file_not_accessible: 'Ya no hay acceso al archivo en Google Drive.',
  file_too_large: 'El archivo es demasiado grande para leerlo.',
  read_error: 'No se pudo leer el archivo. Inténtalo de nuevo.',
};

/** Elegir la fila y abrir la plantilla ya rellenada. «Tus filas» son las que te corresponden por el reparto. */
export function FillDialog({ alert, mine, onClose }: { alert: AlertRow; mine: number[]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const others = (alert.row_refs ?? []).filter((r) => !mine.includes(r));

  async function fill(row: number) {
    setBusy(row);
    setError(null);
    setDone(null);
    try {
      const res = await fetch('/api/fill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertId: alert.id, row }),
      });
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(FILL_ERRORS[b.error] ?? 'No se pudo preparar el documento. Inténtalo de nuevo.');
        return;
      }
      if (type.includes('application/json')) {
        // Archivo de tu ordenador: lo rellena y abre el agente (los datos no salen del PC).
        const b = (await res.json()) as { mode: 'local'; fileId: string; templateId: string; sheet: string | null; row: number };
        try {
          const out = await localFill(b.fileId, b.templateId, b.sheet, b.row);
          setDone(`Documento abierto en tu ordenador (${out.name}).`);
        } catch (e) {
          setError(
            e instanceof LocalAgentError && e.code === 'not_found'
              ? 'Este archivo está en otro ordenador. «Rellenar» solo funciona en el equipo donde está el archivo y su agente.'
              : e instanceof LocalAgentError
                ? LOCAL_ERROR_TEXT[e.code]
                : 'El agente no pudo completar la acción.',
          );
        }
        return;
      }
      // Archivo de Drive: el servidor devuelve el .docx ya relleno.
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${alert.rule_name}_fila${row}.docx`.replace(/[^\p{L}\p{N}._-]+/gu, '_');
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setDone('Documento descargado. Ábrelo con Word para completarlo.');
    } catch {
      setError('No se pudo preparar el documento. Inténtalo de nuevo.');
    } finally {
      setBusy(null);
    }
  }

  const row = (n: number) => (
    <li key={n}>
      <span>Fila {n}</span>
      <button type="button" className="btn primary" disabled={busy !== null} onClick={() => void fill(n)}>
        {busy === n ? 'Preparando…' : 'Rellenar'}
      </button>
    </li>
  );

  return (
    <dialog ref={ref} className="dialog dialog-wide-ish" onClose={onClose} aria-labelledby="fill-title">
      <h2 id="fill-title">Rellenar el informe</h2>
      <p className="muted">
        Se abre la plantilla con los datos de la fila ya puestos. Los datos se leen en este momento y no se guardan en ningún
        servidor.
      </p>
      {mine.length > 0 && (
        <>
          <h3 className="share-h">Te corresponden a ti</h3>
          <ul className="share-list">{mine.map(row)}</ul>
        </>
      )}
      {others.length > 0 && (
        <>
          <h3 className="share-h">{mine.length > 0 ? 'Otras filas de la alerta' : 'Filas de la alerta'}</h3>
          <ul className="share-list">{others.slice(0, 30).map(row)}</ul>
          {others.length > 30 && <p className="muted">Se muestran las primeras 30 filas.</p>}
        </>
      )}
      {error && <p className="err" role="alert">{error}</p>}
      {done && <p className="ok" role="status">{done}</p>}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={() => ref.current?.close()}>
          Cerrar
        </button>
      </div>
    </dialog>
  );
}
