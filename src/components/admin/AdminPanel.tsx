'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AdminUserSelect } from '../AdminUserSelect';
import { ProjectDialog } from '../projects/ProjectDialog';
import { AliasesPanel, TemplatesPanel } from './TemplatesPanel';

interface Overview {
  projects: { id: string; name: string; cover: string | null }[];
  files: { id: string; name: string; source: string; status: string; project_id: string | null; last_error: string | null; rules: number }[];
}

export function AdminPanel() {
  const [userId, setUserId] = useState('');
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ project?: Overview['projects'][number] } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setError(null);
    const res = await fetch(`/api/admin/overview?userId=${userId}`, { cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setData(null);
      setError('No se pudo cargar a esta persona.');
      return;
    }
    setData(body as Overview);
  }, [userId]);

  useEffect(() => {
    setData(null);
    setMsg(null);
    void load();
  }, [load]);

  async function remove(p: { id: string; name: string }) {
    if (!confirm(`¿Eliminar el proyecto «${p.name}»? Sus archivos quedarán sueltos.`)) return;
    const res = await fetch(`/api/projects/${p.id}`, { method: 'DELETE' });
    setMsg(res.ok ? `Proyecto «${p.name}» eliminado.` : 'No se pudo eliminar.');
    void load();
  }

  async function assign(fileId: string, projectId: string) {
    const res = await fetch('/api/files/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileIds: [fileId], projectId: projectId || null }),
    });
    setMsg(res.ok ? 'Archivo asignado.' : 'No se pudo asignar el archivo.');
    void load();
  }

  return (
    <div className="admin-wrap">
      <section className="panel">
        <AdminUserSelect value={userId} onChange={setUserId} label="Gestionar la cuenta de" />
        {error && <p className="err" role="alert">{error}</p>}
        {msg && <p className="ok" role="status">{msg}</p>}
      </section>

      {data && (
        <>
          <section className="panel" aria-labelledby="adm-projects">
            <div className="admin-head">
              <h2 id="adm-projects">Proyectos</h2>
              <button type="button" className="btn primary" onClick={() => setDialog({})}>
                Nuevo proyecto
              </button>
            </div>
            {data.projects.length === 0 && <p className="muted">Esta persona aún no tiene proyectos.</p>}
            <ul className="admin-list">
              {data.projects.map((p) => (
                <li key={p.id}>
                  <strong>{p.name}</strong>
                  <span className="muted">{data.files.filter((f) => f.project_id === p.id).length} archivos</span>
                  <span className="admin-actions">
                    <button type="button" className="btn" onClick={() => setDialog({ project: p })}>
                      Editar
                    </button>
                    <button type="button" className="btn ghost-line" onClick={() => void remove(p)}>
                      Eliminar
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel" aria-labelledby="adm-files">
            <h2 id="adm-files">Archivos y reglas</h2>
            {data.files.length === 0 && <p className="muted">Esta persona aún no ha compartido archivos.</p>}
            <ul className="admin-list">
              {data.files.map((f) => (
                <li key={f.id}>
                  <strong>{f.name}</strong>
                  <span className="muted">
                    {f.source === 'local' ? 'Local' : 'Drive'} · {f.rules} {f.rules === 1 ? 'regla' : 'reglas'}
                  </span>
                  <span className="admin-actions">
                    <label className="sr-only" htmlFor={`as-${f.id}`}>
                      Proyecto de {f.name}
                    </label>
                    <select id={`as-${f.id}`} value={f.project_id ?? ''} onChange={(e) => void assign(f.id, e.target.value)}>
                      <option value="">Sin proyecto</option>
                      {data.projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <Link className="btn" href={`/files/${f.id}`}>
                      Gestionar reglas
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {userId && data && (
        <>
          <TemplatesPanel userId={userId} files={data.files.map((f) => ({ id: f.id, name: f.name }))} />
          <AliasesPanel userId={userId} />
        </>
      )}

      {dialog && (
        <ProjectDialog
          project={dialog.project}
          ownerUserId={userId}
          onSaved={() => void load()}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
