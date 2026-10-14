'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DRAG_MIME, type FileItem, type ProjectOption } from '@/lib/projects/types';
import { FileActions } from '../FileActions';
import { FileTypeIcon, IconMove } from '../Icons';
import { FileIconButton, FilePeek } from './FilePeek';

const STATUS_LABEL: Record<string, string> = {
  active: 'Activo',
  paused: 'Pausado',
  error: 'Con error',
  revoked: 'Reconectar',
};

interface Props {
  files: FileItem[];
  projects: ProjectOption[];
  /** Proyecto que se está viendo (null en el Dashboard: archivos sueltos). */
  currentProjectId: string | null;
  emptyText: string;
  /** Proyecto compartido contigo: solo se ve la lista, sin abrir ni cambiar nada. */
  readOnly?: boolean;
}

/** Lista de archivos con selección múltiple, arrastrar a un proyecto y botón «Mover». */
export function FileList({ files, projects, currentProjectId, emptyText, readOnly = false }: Props) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState<string[] | null>(null);
  const [target, setTarget] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<Set<string>>(new Set());
  const [peek, setPeek] = useState<FileItem | null>(null);

  // Solo cuentan los archivos que siguen en pantalla (tras mover o borrar).
  const chosen = files.filter((f) => selected.has(f.id)).map((f) => f.id);
  const destinations = projects.filter((p) => p.id !== currentProjectId);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (moving && !d.open) d.showModal();
    if (!moving && d.open) d.close();
  }, [moving]);

  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openMove(ids: string[]) {
    setError(null);
    setTarget(currentProjectId ? '' : (destinations[0]?.id ?? ''));
    setMoving(ids);
  }

  async function move(ids: string[], projectId: string | null) {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/files/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileIds: ids, projectId }),
    });
    setBusy(false);
    if (!res.ok) {
      setError('No se pudo mover. Inténtalo de nuevo.');
      return;
    }
    setMoving(null);
    setSelected(new Set());
    router.refresh();
  }

  if (!files.length) return <p className="muted">{emptyText}</p>;

  if (readOnly) {
    return (
      <ul className="file-rows">
        {files.map((f) => (
          <li className="file-row" key={f.id}>
            <FileTypeIcon mime={f.mimeType} />
            <div className="grow">
              <span className="file-name">{f.name}</span>{' '}
              <span className={`pill ${f.status}`}>{STATUS_LABEL[f.status] ?? f.status}</span>
              {f.source === 'local' && <span className="tag tag-local">En un ordenador</span>}
              {f.sheetsLabel && <span className="tag tag-sheet">{f.sheetsLabel}</span>}
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <>
      <div className="list-tools">
        {files.length > 1 && (
          <label className="check-all">
            <input
              type="checkbox"
              checked={chosen.length === files.length}
              onChange={(e) => setSelected(e.target.checked ? new Set(files.map((f) => f.id)) : new Set())}
            />
            Seleccionar todos
          </label>
        )}
        {chosen.length > 0 && (
          <div className="bulk-bar" role="region" aria-label="Acciones sobre los archivos seleccionados">
            <strong>{chosen.length === 1 ? '1 seleccionado' : `${chosen.length} seleccionados`}</strong>
            <button type="button" className="btn" onClick={() => openMove(chosen)}>
              <IconMove size={16} /> Mover a…
            </button>
            {currentProjectId && (
              <button type="button" className="btn" onClick={() => void move(chosen, null)} disabled={busy}>
                Sacar del proyecto
              </button>
            )}
            <button type="button" className="linkbtn" onClick={() => setSelected(new Set())}>
              Quitar selección
            </button>
          </div>
        )}
      </div>

      <ul className="file-rows">
        {files.map((f) => (
          <li
            className={`file-row is-draggable ${selected.has(f.id) ? 'is-selected' : ''} ${dragging.has(f.id) ? 'is-dragging' : ''}`}
            key={f.id}
            draggable
            onDragStart={(e) => {
              // Si arrastras uno de los marcados, se mueven todos los marcados.
              const ids = selected.has(f.id) ? chosen : [f.id];
              e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ids));
              e.dataTransfer.effectAllowed = 'move';
              setDragging(new Set(ids));
            }}
            onDragEnd={() => setDragging(new Set())}
          >
            <input
              type="checkbox"
              className="row-check"
              checked={selected.has(f.id)}
              onChange={() => toggle(f.id)}
              aria-label={`Seleccionar ${f.name}`}
            />
            <FileIconButton name={f.name} onOpen={() => setPeek(f)}>
              <FileTypeIcon mime={f.mimeType} />
            </FileIconButton>
            <div className="grow">
              <Link href={`/files/${f.id}`} className="file-name" draggable={false}>
                {f.name}
              </Link>{' '}
              <span className={`pill ${f.status}`}>{STATUS_LABEL[f.status] ?? f.status}</span>
              {f.source === 'local' && <span className="tag tag-local">En tu ordenador</span>}
              {f.sheetsLabel && <span className="tag tag-sheet">{f.sheetsLabel}</span>}
              <div className="muted">{f.checkedLabel}</div>
              {f.lastError && <div className="err">{f.lastError}</div>}
            </div>
            <Link className="btn" href={`/files/${f.id}`} draggable={false}>
              Reglas y hojas
            </Link>
            <button type="button" className="btn" onClick={() => openMove([f.id])}>
              <IconMove size={16} /> Mover
            </button>
            <FileActions fileId={f.id} />
          </li>
        ))}
      </ul>

      <FilePeek file={peek} onClose={() => setPeek(null)} />

      <dialog ref={dialogRef} className="dialog" onClose={() => setMoving(null)} aria-labelledby="move-dialog-title">
        {moving && (
          <>
            <h2 id="move-dialog-title">
              {moving.length === 1 ? 'Mover archivo' : `Mover ${moving.length} archivos`}
            </h2>
            <fieldset className="move-options">
              <legend className="field-title">Elige el destino</legend>
              {currentProjectId && (
                <label className="choice">
                  <input type="radio" name="dest" checked={target === ''} onChange={() => setTarget('')} />
                  <span>
                    <strong>Sin proyecto</strong>
                    <span className="muted">Vuelve a la lista de archivos sueltos.</span>
                  </span>
                </label>
              )}
              {destinations.map((p) => (
                <label className="choice" key={p.id}>
                  <input type="radio" name="dest" checked={target === p.id} onChange={() => setTarget(p.id)} />
                  <span>
                    <strong>{p.name}</strong>
                  </span>
                </label>
              ))}
            </fieldset>
            {!destinations.length && !currentProjectId && (
              <p className="muted">Todavía no tienes proyectos. Crea uno desde el Dashboard con «Nuevo proyecto».</p>
            )}
            {error && <p className="err" role="alert">{error}</p>}
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={() => setMoving(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={busy || (!currentProjectId && !target)}
                onClick={() => void move(moving, target || null)}
              >
                {busy ? 'Moviendo…' : 'Mover'}
              </button>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}
