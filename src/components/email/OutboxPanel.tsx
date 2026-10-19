'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useEmails } from '../EmailsProvider';
import { IconCheck, IconFolder, IconMail, IconTable } from '../Icons';

export interface OutboxItem {
  id: string;
  fileName: string;
  ruleName: string;
  sheetName: string | null;
  rowNumber: number | null;
  from: string | null;
  to: string;
  cc: string;
  subject: string;
  body: string;
  problem: string | null;
  status: 'pending' | 'drafted';
  projectId: string | null;
  projectName: string | null;
  createdAt: string;
  /** Es de un proyecto compartido conmigo (me toca mandarlo a mí). */
  shared?: boolean;
  /** Tarea con varios nombres: quién la tiene ahora y a quién se puede pasar. */
  handoff?: { alertId: string; now: string | null; next: string | null; prev: string | null; canPass: boolean; canBack: boolean; mine: boolean } | null;
}

const title = (n: string | null) => (n ? n.replace(/\b\p{L}/gu, (c) => c.toUpperCase()) : '');

/**
 * «Tienes pendiente mandar el correo…», agrupado por proyecto igual que las alertas.
 * La persona revisa cada correo y lo manda desde su Outlook clásico.
 */
export function OutboxPanel({ items: initial, projects }: { items: OutboxItem[]; projects: { id: string; name: string }[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const { refreshPending } = useEmails();
  // Llegan correos nuevos (o se envían desde el agente): la lista sigue al servidor.
  useEffect(() => setItems(initial), [initial]);
  const [filter, setFilter] = useState('all');
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolve(id: string, action: 'sent' | 'dismissed') {
    setError(null);
    const res = await fetch(`/api/outbox/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (!res.ok) {
      setError('No se pudo actualizar. Inténtalo de nuevo.');
      return;
    }
    setItems((cur) => cur.filter((i) => i.id !== id));
    void refreshPending();
    router.refresh();
  }

  async function handoff(item: OutboxItem, delta: 1 | -1) {
    setError(null);
    if (!item.handoff || item.rowNumber == null) return;
    if (
      delta === 1 &&
      item.status === 'drafted' &&
      !window.confirm('Ya hay un borrador de este correo en tu Outlook. Se queda ahí: bórralo tú. A la otra persona le llegará uno nuevo. ¿Pasar la tarea?')
    ) {
      return;
    }
    const { error: rpcError } = await createClient().rpc('handoff_task', { p_alert: item.handoff.alertId, p_row: item.rowNumber, p_delta: delta });
    if (rpcError) {
      setError('No se pudo pasar la tarea. Puede que ya no la tengas tú.');
      return;
    }
    void refreshPending();
    router.refresh();
  }

  async function copy(item: OutboxItem) {
    const text = `Para: ${item.to}${item.cc ? `\nCC: ${item.cc}` : ''}\nAsunto: ${item.subject}\n\n${item.body}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(item.id);
      setTimeout(() => setCopied((c) => (c === item.id ? null : c)), 2500);
    } catch {
      setError('Tu navegador no deja copiar automáticamente. Selecciona el texto y cópialo a mano.');
    }
  }

  if (!items.length) {
    return (
      <div className="empty">
        <span className="empty-icon">
          <IconCheck size={28} />
        </span>
        <strong>No tienes correos pendientes</strong>
        <p className="muted">Cuando una regla prepare un correo que no se haya enviado solo, aparecerá aquí.</p>
      </div>
    );
  }

  const visible = items.filter((i) => (filter === 'all' ? true : filter === 'none' ? !i.projectId : i.projectId === filter));

  return (
    <>
      {error && <p className="err" role="alert">{error}</p>}
      {projects.length > 0 && (
        <label className="scope-select">
          <span className="field-title">Proyecto</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">Todos los proyectos</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            <option value="none">Sin proyecto</option>
          </select>
        </label>
      )}
      {visible.length === 0 && <p className="muted">No hay correos pendientes en este proyecto.</p>}

      <ul className="alert-list">
        {visible.map((i) => {
          return (
            <li key={i.id} className={`alert-item sev-${i.problem ? 'warning' : 'info'} is-open`}>
              <span className="alert-sev" title="Correo pendiente">
                <IconMail size={18} />
              </span>
              <div className="grow">
                <strong className="alert-msg">Tienes pendiente mandar el correo «{i.subject || '(sin asunto)'}»</strong>
                <div className="chips">
                  <span className="tag tag-file">
                    <IconTable size={14} />
                    {i.fileName}
                  </span>
                  {i.sheetName && <span className="tag tag-sheet">Hoja «{i.sheetName}»</span>}
                  {i.projectName && (
                    <span className="tag tag-project">
                      <IconFolder size={14} />
                      {i.projectName}
                    </span>
                  )}
                  {i.rowNumber != null && <span className="tag tag-count">Fila {i.rowNumber}</span>}
                  <span className="tag tag-rule">Regla «{i.ruleName}»</span>
                  {i.status === 'drafted' && <span className="tag tag-count">Borrador en tu Outlook</span>}
                  {i.shared && <span className="tag tag-count">Compartido contigo</span>}
                  {i.handoff && !i.handoff.mine && i.handoff.now && <span className="tag tag-count">Lo tiene {title(i.handoff.now)}</span>}
                </div>
                <p className="muted" style={{ margin: '6px 0 0' }}>
                  <strong>Para:</strong> {i.to || '(sin destinatario)'}
                  {i.cc && (
                    <>
                      {' · '}
                      <strong>CC:</strong> {i.cc}
                    </>
                  )}
                  {i.from && (
                    <>
                      {' · '}
                      <strong>Desde:</strong> {i.from}
                    </>
                  )}
                </p>
                {i.problem && <p className="err">⚠ {i.problem}</p>}
                <div style={{ whiteSpace: 'pre-wrap', margin: '8px 0', maxHeight: 160, overflow: 'auto' }}>{i.body}</div>
                <time className="muted" dateTime={i.createdAt}>
                  {new Date(i.createdAt).toLocaleString('es-ES')}
                </time>
              </div>
              <div className="alert-actions">
                <button type="button" className="btn" onClick={() => void copy(i)}>
                  {copied === i.id ? 'Copiado' : 'Copiar texto'}
                </button>
                {i.handoff?.canPass && i.handoff.next && (
                  <button type="button" className="btn" onClick={() => void handoff(i, 1)}>
                    Pasar tarea a {title(i.handoff.next)}
                  </button>
                )}
                {i.handoff?.canBack && i.handoff.prev && (
                  <button type="button" className="btn ghost-line" onClick={() => void handoff(i, -1)}>
                    Devolver a {title(i.handoff.prev)}
                  </button>
                )}
                <button type="button" className="btn" onClick={() => void resolve(i.id, 'sent')}>
                  <IconCheck size={16} /> Ya lo he enviado
                </button>
                <button type="button" className="btn ghost-line" onClick={() => void resolve(i.id, 'dismissed')}>
                  Descartar
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
