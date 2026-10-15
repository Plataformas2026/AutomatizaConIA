'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAlerts } from './AlertsProvider';
import { useEmails } from './EmailsProvider';
import { IconBell, IconChart, IconGrid, IconMail, IconSpark, IconUsers } from './Icons';

/** Barra de pestañas: la sección actual queda marcada con color, subrayado y aria-current. */
export function NavTabs({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const { unread } = useAlerts();
  const { pending } = useEmails();

  const onDashboard = pathname === '/dashboard' || pathname.startsWith('/files') || pathname.startsWith('/projects') || pathname.startsWith('/agent');
  const onEmails = pathname.startsWith('/emails');
  const onAlerts = pathname.startsWith('/alerts');
  const onStats = pathname.startsWith('/stats');
  const onModels = pathname.startsWith('/models');
  const onAdmin = pathname.startsWith('/admin');
  const badge = unread > 99 ? '99+' : `+${unread}`;
  const mailBadge = pending > 99 ? '99+' : `+${pending}`;

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
        href="/emails"
        className={`tab ${onEmails ? 'is-active' : ''}`}
        style={{ ['--tab-color' as string]: 'var(--info)' }}
        aria-current={onEmails ? 'page' : undefined}
      >
        <span className={`bell ${pending > 0 ? 'has-unread has-mail' : ''}`}>
          <IconMail size={18} />
          {pending > 0 && (
            <span className="badge badge-mail" key={pending} aria-hidden="true">
              {mailBadge}
            </span>
          )}
        </span>
        Correos
        {pending > 0 && <span className="sr-only">, {pending} pendientes</span>}
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
      <Link
        href="/models"
        className={`tab ${onModels ? 'is-active' : ''}`}
        style={{ ['--tab-color' as string]: 'var(--amber)' }}
        aria-current={onModels ? 'page' : undefined}
      >
        <IconSpark size={18} />
        Informes y Modelos IA
      </Link>
      {isAdmin && (
        <Link
          href="/admin"
          className={`tab ${onAdmin ? 'is-active' : ''}`}
          style={{ ['--tab-color' as string]: 'var(--ink, #1f1a3a)' }}
          aria-current={onAdmin ? 'page' : undefined}
        >
          <IconUsers size={18} />
          Administración
        </Link>
      )}
    </nav>
  );
}
