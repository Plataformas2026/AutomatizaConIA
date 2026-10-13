'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface Member {
  id: string;
  email: string;
  since: string;
}
interface Invitation {
  id: string;
  email: string;
}

const ERRORS: Record<string, string> = {
  invalid_email: 'Escribe un correo válido.',
  self_invite: 'Ese es tu propio correo: ya tienes acceso.',
  too_many_shares: 'Has llegado al máximo de 20 personas en este proyecto.',
};

/** Compartir un proyecto: la otra persona lo ve en su Dashboard, con sus alertas y estadísticas (solo lectura). */
export function ShareDialog({ projectId, projectName, onClose }: { projectId: string; projectName: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/share`, { cache: 'no-store' });
    if (res.ok) {
      const body = await res.json();
      setMembers(body.members ?? []);
      setInvitations(body.invitations ?? []);
    } else {
      setError('No se pudo cargar la lista. Inténtalo de nuevo.');
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
    void load();
  }, [load]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/projects/${projectId}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(ERRORS[body.error] ?? 'No se pudo invitar. Inténtalo de nuevo.');
      return;
    }
    setEmail('');
    await load();
  }

  async function remove(kind: 'member' | 'invitation', id: string) {
    setError(null);
    const res = await fetch(`/api/projects/${projectId}/share`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, id }),
    });
    if (!res.ok) {
      setError('No se pudo quitar el acceso. Inténtalo de nuevo.');
      return;
    }
    await load();
  }

  return (
    <dialog ref={dialogRef} className="dialog" onClose={onClose} aria-labelledby="share-title">
      <h2 id="share-title">Compartir «{projectName}»</h2>
      <p className="muted">
        La persona invitada verá este proyecto en su Dashboard, junto con sus alertas y estadísticas. Solo podrá mirar:
        no cambia nada, no ve tus reglas ni tus correos pendientes, y los archivos siguen en tu Drive o en tu ordenador.
      </p>

      <form onSubmit={invite} className="share-form">
        <div className="field grow">
          <label htmlFor="share-email">Correo de la persona</label>
          <input
            id="share-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nombre@empresa.com"
            required
            autoFocus
          />
        </div>
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'Invitando…' : 'Invitar'}
        </button>
      </form>
      <p className="muted share-note">
        Tiene que entrar en la aplicación con ese mismo correo (ya confirmado). Si aún no tiene cuenta, se la crea con él.
      </p>

      {error && <p className="err" role="alert">{error}</p>}

      <h3 className="share-h">Con acceso</h3>
      {loading ? (
        <p className="muted">Cargando…</p>
      ) : members.length + invitations.length === 0 ? (
        <p className="muted">Todavía no has compartido este proyecto con nadie.</p>
      ) : (
        <ul className="share-list">
          {members.map((m) => (
            <li key={m.id}>
              <span className="grow">{m.email}</span>
              <button type="button" className="btn ghost-line" onClick={() => void remove('member', m.id)}>
                Quitar acceso
              </button>
            </li>
          ))}
          {invitations.map((i) => (
            <li key={i.id}>
              <span className="grow">
                {i.email} <span className="tag tag-count">Pendiente de entrar</span>
              </span>
              <button type="button" className="btn ghost-line" onClick={() => void remove('invitation', i.id)}>
                Cancelar invitación
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="dialog-actions">
        <button type="button" className="btn primary" onClick={() => dialogRef.current?.close()}>
          Listo
        </button>
      </div>
    </dialog>
  );
}
