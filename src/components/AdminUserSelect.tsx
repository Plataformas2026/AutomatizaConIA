'use client';

import { useEffect, useId, useState } from 'react';
import { useIsAdmin } from './AdminProvider';

export interface AdminUserOption {
  userId: string;
  email: string;
  companyId: string;
  companyName: string;
  isMe: boolean;
}

let cache: AdminUserOption[] | null = null;

/** Hook: lista de usuarios (solo si es administrador). */
export function useAdminUsers(): { users: AdminUserOption[]; error: string | null } {
  const isAdmin = useIsAdmin();
  const [users, setUsers] = useState<AdminUserOption[]>(cache ?? []);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!isAdmin || cache) return;
    let alive = true;
    fetch('/api/admin/users', { cache: 'no-store' })
      .then(async (r) => {
        const b = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error('x');
        cache = b.users as AdminUserOption[];
        if (alive) setUsers(cache);
      })
      .catch(() => alive && setError('No se pudo cargar la lista de usuarios.'));
    return () => {
      alive = false;
    };
  }, [isAdmin]);
  return { users, error };
}

interface Props {
  value: string;
  onChange?: (userId: string) => void;
  /** Solo lectura: se muestra a quién pertenece (p. ej. al editar). */
  disabled?: boolean;
  label?: string;
  hint?: string;
}

/** Selector de usuario. NO se pinta si quien mira no es administrador. */
export function AdminUserSelect({ value, onChange, disabled, label = 'Usuario', hint }: Props) {
  const isAdmin = useIsAdmin();
  const id = useId();
  const { users, error } = useAdminUsers();
  // Sin valor inicial: se propone «yo» en cuanto llega la lista.
  useEffect(() => {
    if (!value && onChange) {
      const me = users.find((u) => u.isMe);
      if (me) onChange(me.userId);
    }
  }, [value, users, onChange]);
  if (!isAdmin) return null;
  return (
    <div className="field admin-field">
      <label htmlFor={id}>
        {label} <span className="tag admin-tag">Administrador</span>
      </label>
      <select id={id} value={value} disabled={disabled} onChange={(e) => onChange?.(e.target.value)}>
        {users.length === 0 && <option value={value}>{error ?? 'Cargando usuarios…'}</option>}
        {users.map((u) => (
          <option key={u.userId} value={u.userId}>
            {u.email}
            {u.isMe ? ' (yo)' : ''}
          </option>
        ))}
      </select>
      {hint && <span className="muted">{hint}</span>}
    </div>
  );
}
