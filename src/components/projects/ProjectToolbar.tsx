'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconEdit, IconTrash, IconUsers } from '../Icons';
import { ProjectDialog } from './ProjectDialog';
import { ShareDialog } from './ShareDialog';

/** Editar (nombre y portada) y eliminar un proyecto. Eliminarlo NO borra sus archivos. */
export function ProjectToolbar({ project }: { project: { id: string; name: string; cover: string | null } }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!confirm(`¿Eliminar el proyecto «${project.name}»? Sus archivos seguirán compartidos, pero quedarán sueltos, y dejarás de compartirlo con otras personas (sus gráficas se borran con el proyecto).`)) {
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' });
    if (res.ok) {
      router.push('/dashboard');
      router.refresh();
    } else {
      setBusy(false);
    }
  }

  return (
    <div className="row wrap">
      <button type="button" className="btn" onClick={() => setEditing(true)}>
        <IconEdit size={16} /> Editar nombre y portada
      </button>
      <button type="button" className="btn" onClick={() => setSharing(true)}>
        <IconUsers size={16} /> Compartir
      </button>
      <button type="button" className="btn danger" onClick={remove} disabled={busy}>
        <IconTrash size={16} /> Eliminar proyecto
      </button>
      {editing && <ProjectDialog project={project} onClose={() => setEditing(false)} />}
      {sharing && <ShareDialog projectId={project.id} projectName={project.name} onClose={() => setSharing(false)} />}
    </div>
  );
}
