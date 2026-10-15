'use client';

import Link from 'next/link';
import { useAlerts } from './AlertsProvider';
import { useEmails } from './EmailsProvider';
import { IconBell, IconClose, IconMail } from './Icons';

const SEVERITY_LABEL = { info: 'Informativa', warning: 'Aviso', critical: 'Crítica' } as const;

/** Avisos emergentes en la esquina: aparecen al instante cuando salta una alerta nueva. */
export function ToastViewport() {
  const { toasts, dismissToast } = useAlerts();
  const { toasts: mailToasts, dismissToast: dismissMail } = useEmails();

  return (
    <div className="toasts" role="region" aria-label="Avisos nuevos" aria-live="polite">
      {mailToasts.map((m) => (
        <div key={m.id} className={`toast toast-mail ${m.problem ? 'sev-warning' : 'sev-info'}`} role="status">
          <span className="toast-icon">
            <IconMail size={20} />
          </span>
          <div className="toast-body">
            <strong>{m.problem ? 'Correo pendiente: hay que revisarlo' : 'Nuevo correo pendiente'}</strong>
            <p>{m.ruleName || 'Un correo está listo para revisar y enviar.'}</p>
            <span className="toast-meta">
              {m.fileName}
              {m.sheetName ? ` — hoja «${m.sheetName}»` : ''}
              {m.rowNumber ? ` — fila ${m.rowNumber}` : ''}
            </span>
            <Link href="/emails" className="toast-link" onClick={() => dismissMail(m.id)}>
              Ver correos
            </Link>
          </div>
          <button type="button" className="toast-close" onClick={() => dismissMail(m.id)} aria-label="Cerrar aviso">
            <IconClose size={16} />
          </button>
        </div>
      ))}
      {toasts.map(({ id, alert }) => (
        <div key={id} className={`toast sev-${alert.severity}`} role="status">
          <span className="toast-icon">
            <IconBell size={20} />
          </span>
          <div className="toast-body">
            <strong>{SEVERITY_LABEL[alert.severity]}: nueva alerta</strong>
            <p>{alert.message}</p>
            <span className="toast-meta">
              {alert.file_name}
              {alert.sheet_name ? ` — hoja «${alert.sheet_name}»` : ''}
            </span>
            <Link href="/alerts" className="toast-link" onClick={() => dismissToast(id)}>
              Ver alertas
            </Link>
          </div>
          <button type="button" className="toast-close" onClick={() => dismissToast(id)} aria-label="Cerrar aviso">
            <IconClose size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
