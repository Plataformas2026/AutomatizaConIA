'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAlerts } from './AlertsProvider';
import { IconBell, IconChart, IconGrid } from './Icons';

/** Barra de pestañas: la sección actual queda marcada con color, subrayado y aria-current. */
export function NavTabs() {
  const pathname = usePathname();
  const { unread } = useAlerts();

  const onDashboard = pathname === '/dashboard' || pathname.startsWith('/files');
  const onAlerts = pathname.startsWith('/alerts');
  const onStats = pathname.startsWith('/stats');
  const badge = unread > 99 ? '99+' : `+${unread}`;

  return (
    <nav className="tabs" aria-label="Secciones">
      <Link
        href="/dashboard"
        className={`tab ${onDashboard ? 'is-active' : ''}`}
        style={{ ['--tab-color' as string]: 'var(--violet)' }}
        aria-current={onDashboard ? 'page' : undefined}
      >
        <IconGrid size={18} />
        Dashboard
      </Link>
      <Link
        href="/alerts"
        className={`tab ${onAlerts ? 'is-active' : ''}`}
        style={{ ['--tab-color' as string]: 'var(--coral)' }}
        aria-current={onAlerts ? 'page' : undefined}
      >
        <span className={`bell ${unread > 0 ? 'has-unread' : ''}`}>
          <IconBell size={18} />
          {unread > 0 && (
            <span className="badge" key={unread} aria-hidden="true">
              {badge}
            </span>
          )}
        </span>
        Alertas
        {unread > 0 && <span className="sr-only">, {unread} sin leer</span>}
      </Link>
      <Link
        href="/stats"
        className={`tab ${onStats ? 'is-active' : ''}`}
        style={{ ['--tab-color' as string]: 'var(--teal)' }}
        aria-current={onStats ? 'page' : undefined}
      >
        <IconChart size={18} />
        Estadísticas
      </Link>
    </nav>
  );
}
