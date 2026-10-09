'use client';

import Link from 'next/link';
import { useAlerts } from './AlertsProvider';
import { IconBell, IconClose } from './Icons';

const SEVERITY_LABEL = { info: 'Informativa', warning: 'Aviso', critical: 'Crítica' } as const;

/** Avisos emergentes en la esquina: aparecen al instante cuando salta una alerta nueva. */
export function ToastViewport() {
  const { toasts, dismissToast } = useAlerts();

  return (
    <div className="toasts" role="region" aria-label="Alertas nuevas" aria-live="polite">
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
