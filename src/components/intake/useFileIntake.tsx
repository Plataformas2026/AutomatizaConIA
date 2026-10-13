'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { SheetSelection } from '@/lib/parsing/parse';
import { SheetPicker, isValidSelection } from '../SheetPicker';

export const INTAKE_ERRORS: Record<string, string> = {
  already_added: 'ya estaba compartido.',
  unsupported_type: 'solo se admiten Excel (.xlsx/.xls), CSV y Hojas de cálculo de Google.',
  file_not_accessible: 'no tenemos acceso. Vuelve a elegirlo en el selector.',
  file_too_large: 'es demasiado grande para leerlo.',
  watch_failed: 'no se pudo activar el aviso en tiempo real.',
  google_not_connected: 'conecta primero tu Google Drive.',
  project_not_found: 'el proyecto de destino ya no existe.',
};

interface SheetsQuestion {
  name: string;
  sheets: string[];
  position: number;
  total: number;
}

interface Outcome {
  added: number;
  skipped: number;
  problems: { name: string; reason: string }[];
}

/**
 * Lógica común de «añadir archivos» (Drive o ordenador): procesa una LISTA de archivos de
 * Drive de uno en uno. Si un Excel tiene varias hojas, pregunta cuáles vigilar.
 */
export function useFileIntake(projectId: string | null = null) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const resolver = useRef<((sel: SheetSelection | null) => void) | null>(null);

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState<SheetsQuestion | null>(null);
  const [selection, setSelection] = useState<SheetSelection>({ mode: 'selected', names: [] });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (question && !dialog.open) dialog.showModal();
    if (!question && dialog.open) dialog.close();
  }, [question]);

  const ask = useCallback((q: SheetsQuestion) => {
    return new Promise<SheetSelection | null>((resolve) => {
      resolver.current = resolve;
      setSelection({ mode: 'selected', names: [q.sheets[0]] });
      setQuestion(q);
    });
  }, []);

  function answer(sel: SheetSelection | null) {
    resolver.current?.(sel);
    resolver.current = null;
    setQuestion(null);
  }

  async function register(driveFileId: string, sel: SheetSelection): Promise<string | null> {
    const res = await fetch('/api/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driveFileId, sheetMode: sel.mode, sheetNames: sel.names, projectId }),
    });
    if (res.ok) return null;
    const body = await res.json().catch(() => ({}));
    return INTAKE_ERRORS[body.error] ?? 'no se pudo añadir.';
  }

  /** Añade varios archivos de Drive (ya accesibles para la app) uno tras otro. */
  const addDriveFiles = useCallback(
    async (ids: string[]) => {
      setError(null);
      setOutcome(null);
      setBusy(true);
      const result: Outcome = { added: 0, skipped: 0, problems: [] };

      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        let name = `Archivo ${i + 1}`;
        setStatus(ids.length > 1 ? `Añadiendo archivo ${i + 1} de ${ids.length}…` : 'Añadiendo archivo…');
        try {
          const res = await fetch('/api/files/inspect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ driveFileId: id }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) {
            result.problems.push({ name, reason: INTAKE_ERRORS[body.error] ?? 'no se pudo leer.' });
            continue;
          }
          name = body.name ?? name;
          const sheets: string[] = body.sheets ?? [];

          let sel: SheetSelection | null = { mode: 'first', names: [] };
          if (sheets.length > 1) {
            sel = await ask({ name, sheets, position: i + 1, total: ids.length });
            if (!sel) {
              result.skipped += 1;
              continue;
            }
            setStatus(ids.length > 1 ? `Añadiendo archivo ${i + 1} de ${ids.length}…` : 'Añadiendo archivo…');
          }
          const problem = await register(id, sel);
          if (problem) result.problems.push({ name, reason: problem });
          else result.added += 1;
        } catch {
          result.problems.push({ name, reason: 'no se pudo leer.' });
        }
      }

      setOutcome(result);
      setStatus(null);
      setBusy(false);
      router.refresh();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ask, projectId, router],
  );

  const feedback: ReactNode = (
    <>
      {status && (
        <div className="muted intake-status" role="status">
          {status}
        </div>
      )}
      {error && <div className="err">{error}</div>}
      {outcome && (
        <div className="intake-result" role="status">
          {outcome.added > 0 && (
            <div className="ok">
              {outcome.added === 1 ? '1 archivo añadido.' : `${outcome.added} archivos añadidos.`}
            </div>
          )}
          {outcome.skipped > 0 && (
            <div className="muted">
              {outcome.skipped === 1 ? '1 archivo omitido.' : `${outcome.skipped} archivos omitidos.`}
            </div>
          )}
          {outcome.problems.map((p, i) => (
            <div className="err" key={i}>
              «{p.name}»: {p.reason}
            </div>
          ))}
        </div>
      )}
    </>
  );

  const dialog: ReactNode = (
    <dialog ref={dialogRef} className="dialog" onCancel={() => answer(null)} aria-labelledby="sheets-dialog-title">
      {question && (
        <>
          <h2 id="sheets-dialog-title">¿Qué hojas quieres vigilar?</h2>
          <p className="muted">
            {question.total > 1 && (
              <>
                Archivo {question.position} de {question.total} ·{' '}
              </>
            )}
            <strong>{question.name}</strong> tiene {question.sheets.length} hojas. Puedes cambiar esta elección más
            adelante.
          </p>
          <SheetPicker sheets={question.sheets} value={selection} onChange={setSelection} />
          {!isValidSelection(selection) && <p className="err">Marca al menos una hoja.</p>}
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => answer(null)}>
              {question.total > 1 ? 'Omitir este archivo' : 'Cancelar'}
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => isValidSelection(selection) && answer(selection)}
              disabled={!isValidSelection(selection)}
            >
              Añadir archivo
            </button>
          </div>
        </>
      )}
    </dialog>
  );

  return { busy, setBusy, setStatus, setError, addDriveFiles, feedback, dialog };
}
