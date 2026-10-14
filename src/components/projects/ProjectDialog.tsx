'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { COVER_MAX_CHARS, PROJECT_ERRORS } from '@/lib/projects/types';
import { IconImage } from '../Icons';
import { AdminUserSelect } from '../AdminUserSelect';
import { useIsAdmin } from '../AdminProvider';

const COVER_SIZE = 480;

/** Recorta al centro en cuadrado y reduce a JPEG ligero (≈30-60 KB) antes de guardarlo. */
async function toSquareCover(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('image'));
      el.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    if (!side) throw new Error('image');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = COVER_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, COVER_SIZE, COVER_SIZE);
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;
    ctx.drawImage(img, sx, sy, side, side, 0, 0, COVER_SIZE, COVER_SIZE);
    for (const q of [0.82, 0.7, 0.55]) {
      const data = canvas.toDataURL('image/jpeg', q);
      if (data.length <= COVER_MAX_CHARS * 0.8) return data;
    }
    throw new Error('too_big');
  } finally {
    URL.revokeObjectURL(url);
  }
}

interface Props {
  /** Sin `project`: crear. Con `project`: editar nombre y portada. */
  project?: { id: string; name: string; cover: string | null };
  /** Solo administradores: al crear, usuario propuesto; al editar, dueño del proyecto (solo lectura). */
  ownerUserId?: string;
  /** Se llama tras guardar (si no, se refresca la página). */
  onSaved?: () => void;
  onClose: () => void;
}

export function ProjectDialog({ project, ownerUserId, onSaved, onClose }: Props) {
  const router = useRouter();
  const isAdmin = useIsAdmin();
  const [forUserId, setForUserId] = useState<string>(ownerUserId ?? '');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(project?.name ?? '');
  const [cover, setCover] = useState<string | null>(project?.cover ?? null);
  const [coverChanged, setCoverChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
  }, []);

  async function pickImage(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith('image/')) {
      setError('Elige una imagen (JPG, PNG, WebP…).');
      return;
    }
    try {
      setCover(await toSquareCover(file));
      setCoverChanged(true);
    } catch {
      setError('No se pudo leer esa imagen. Prueba con otra.');
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(PROJECT_ERRORS.name);
      return;
    }
    setBusy(true);
    setError(null);
    const payload: { name: string; cover?: string | null; forUserId?: string } = { name: trimmed };
    if (isAdmin && !project && forUserId) payload.forUserId = forUserId;
    if (!project || coverChanged) payload.cover = cover;
    const res = await fetch(project ? `/api/projects/${project.id}` : '/api/projects', {
      method: project ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(PROJECT_ERRORS[body.error] ?? PROJECT_ERRORS.db_error);
      setBusy(false);
      return;
    }
    if (onSaved) onSaved();
    else router.refresh();
    onClose();
  }

  return (
    <dialog ref={dialogRef} className="dialog" onClose={onClose} aria-labelledby="project-dialog-title">
      <form onSubmit={save}>
        <h2 id="project-dialog-title">{project ? 'Editar proyecto' : 'Nuevo proyecto'}</h2>

        <div className="field">
          <label htmlFor="project-name">Nombre del proyecto</label>
          <input
            id="project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            placeholder="Por ejemplo: Ventas 2026"
            autoFocus
            required
          />
        </div>

        <AdminUserSelect
          value={forUserId}
          onChange={setForUserId}
          disabled={!!project}
          label={project ? 'Propietario' : 'Crear para'}
          hint={project ? 'Un proyecto no cambia de dueño; para otro usuario, créalo de nuevo a su nombre.' : 'El proyecto aparecerá en la cuenta de esta persona.'}
        />

        <div className="field">
          <span className="field-title">Foto de portada (opcional)</span>
          <div className="cover-edit">
            <div className={`cover-preview ${cover ? '' : 'is-empty'}`}>
              {cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={cover} alt="Vista previa de la portada" />
              ) : (
                <IconImage size={32} />
              )}
            </div>
            <div className="cover-actions">
              <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
                {cover ? 'Cambiar foto' : 'Elegir foto'}
              </button>
              {cover && (
                <button
                  type="button"
                  className="btn ghost-line"
                  onClick={() => {
                    setCover(null);
                    setCoverChanged(true);
                  }}
                >
                  Quitar foto
                </button>
              )}
              <span className="muted">Se recorta en cuadrado y se reduce para ocupar muy poco.</span>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="sr-only"
              tabIndex={-1}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                void pickImage(f);
              }}
            />
          </div>
        </div>

        {error && <p className="err" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => dialogRef.current?.close()}>
            Cancelar
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Guardando…' : project ? 'Guardar cambios' : 'Crear proyecto'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
