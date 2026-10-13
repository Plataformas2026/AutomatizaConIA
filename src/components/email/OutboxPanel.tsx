'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { mailtoLink, outlookPersonalLink, outlookWebLink } from '@/lib/email/links';
import { IconCheck, IconMail } from '../Icons';

export interface OutboxItem {
  id: string;
  fileName: string;
  ruleName: string;
  sheetName: string | null;
  rowNumber: number | null;
  from: string | null;
  to: string;
  subject: string;
  body: string;
  problem: string | null;
  status: 'pending' | 'drafted';
}

/**
 * «Tienes pendiente mandar el correo…»: correos que la regla ha preparado y que no se
 * han podido enviar solos. La persona los revisa y los manda desde su Outlook.
 */
export function OutboxPanel({ items: initial }: { items: OutboxItem[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
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
    router.refresh();
  }

  async function copy(item: OutboxItem) {
    const text = `Para: ${item.to}\nAsunto: ${item.subject}\n\n${item.body}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(item.id);
      setTimeout(() => setCopied((c) => (c === item.id ? null : c)), 2500);
    } catch {
      setError('Tu navegador no deja copiar automáticamente. Selecciona el texto y cópialo a mano.');
    }
  }

  if (!items.length) return null;

  return (
    <section aria-labelledby="outbox-title">
      <h2 id="outbox-title">
        <IconMail size={20} /> Correos pendientes de enviar ({items.length})
      </h2>
      <p className="muted section-hint">
        Estos correos están preparados con los datos de tus archivos, pero no se han enviado solos. Revísalos y envíalos
        desde tu Outlook; luego pulsa «Ya lo he enviado».
      </p>
      {error && <p className="err" role="alert">{error}</p>}
      <div className="outbox">
        {items.map((i) => {
          const sendable = !i.problem && !!i.to;
          return (
            <article className="outbox-item" key={i.id}>
              <h3>Tienes pendiente mandar el correo «{i.subject || '(sin asunto)'}»</h3>
              <div className="chips">
                <span className="tag tag-file">{i.fileName}</span>
                {i.sheetName && <span className="tag tag-sheet">Hoja «{i.sheetName}»</span>}
                {i.rowNumber != null && <span className="tag tag-count">Fila {i.rowNumber}</span>}
                <span className="tag tag-rule">Regla «{i.ruleName}»</span>
                {i.status === 'drafted' && <span className="tag tag-count">Borrador en tu Outlook</span>}
              </div>
              <dl className="outbox-meta">
                <div>
                  <dt>Para:</dt>
                  <dd>{i.to || '(sin destinatario)'}</dd>
                </div>
                {i.from && (
                  <div>
                    <dt>Debe enviarse desde:</dt>
                    <dd>{i.from}</dd>
                  </div>
                )}
              </dl>
              {i.problem && <p className="outbox-problem">⚠ {i.problem}</p>}
              <div className="outbox-body">{i.body}</div>
              <div className="outbox-actions">
                {sendable && (
                  <>
                    <a className="btn primary" href={mailtoLink(i.to, i.subject, i.body)}>
                      Abrir en mi correo (Outlook)
                    </a>
                    <a className="btn" href={outlookWebLink(i.to, i.subject, i.body)} target="_blank" rel="noopener noreferrer">
                      Outlook en la web (trabajo)
                    </a>
                    <a className="btn" href={outlookPersonalLink(i.to, i.subject, i.body)} target="_blank" rel="noopener noreferrer">
                      Outlook.com (personal)
                    </a>
                  </>
                )}
                <button type="button" className="btn" onClick={() => void copy(i)}>
                  {copied === i.id ? 'Copiado' : 'Copiar texto'}
                </button>
                <button type="button" className="btn" onClick={() => void resolve(i.id, 'sent')}>
                  <IconCheck size={16} /> Ya lo he enviado
                </button>
                <button type="button" className="btn ghost-line" onClick={() => void resolve(i.id, 'dismissed')}>
                  Descartar
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
