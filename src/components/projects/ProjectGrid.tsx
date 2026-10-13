'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DRAG_MIME, type ProjectCard } from '@/lib/projects/types';
import { IconFolder, IconPlus } from '../Icons';
import { ProjectDialog } from './ProjectDialog';

/** Color de relleno estable para proyectos sin portada. */
export function coverTone(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 4;
}

export function ProjectCover({ name, cover }: { name: string; cover: string | null }) {
  return cover ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="pcard-img" src={cover} alt="" loading="lazy" />
  ) : (
    <span className={`pcard-img pcard-ph tone-${coverTone(name)}`} aria-hidden="true">
      <IconFolder size={40} />
    </span>
  );
}

/** Cuadrícula de proyectos. Cada tarjeta acepta archivos arrastrados desde la lista. */
export function ProjectGrid({ projects }: { projects: ProjectCard[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [overId, setOverId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function drop(e: React.DragEvent, project: ProjectCard) {
    e.preventDefault();
    setOverId(null);
    let ids: string[] = [];
    try {
      ids = JSON.parse(e.dataTransfer.getData(DRAG_MIME));
    } catch {
      return;
    }
    if (!Array.isArray(ids) || !ids.length) return;
    const res = await fetch('/api/files/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileIds: ids, projectId: project.id }),
    });
    if (res.ok) {
      setMessage({
        text: `${ids.length === 1 ? '1 archivo movido' : `${ids.length} archivos movidos`} a «${project.name}».`,
        error: false,
      });
      router.refresh();
    } else {
      setMessage({ text: 'No se pudo mover. Inténtalo de nuevo.', error: true });
    }
  }

  return (
    <>
      <ul className="pgrid">
        {projects.map((p) => (
          <li key={p.id}>
            <Link
              href={`/projects/${p.id}`}
              className={`pcard ${overId === p.id ? 'is-over' : ''}`}
              draggable={false}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes(DRAG_MIME)) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setOverId(p.id);
                }
              }}
              onDragLeave={() => setOverId((cur) => (cur === p.id ? null : cur))}
              onDrop={(e) => void drop(e, p)}
            >
              <ProjectCover name={p.name} cover={p.cover} />
              <span className="pcard-body">
                <span className="pcard-name">{p.name}</span>
                <span className="muted">{p.fileCount === 1 ? '1 archivo' : `${p.fileCount} archivos`}</span>
              </span>
              <span className="pcard-drop" aria-hidden="true">
                Suelta aquí
              </span>
            </Link>
          </li>
        ))}
        <li>
          <button type="button" className="pcard pcard-new" onClick={() => setCreating(true)}>
            <span className="pcard-plus">
              <IconPlus size={26} />
            </span>
            <span className="pcard-name">Nuevo proyecto</span>
          </button>
        </li>
      </ul>
      {message && (
        <p className={message.error ? 'err' : 'ok'} role="status">
          {message.text}
        </p>
      )}
      {creating && <ProjectDialog onClose={() => setCreating(false)} />}
    </>
  );
}
