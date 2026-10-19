import { redirect } from 'next/navigation';
import { getSessionContext } from '@/lib/auth';
import { EmailsProvider } from '@/components/EmailsProvider';
import { AlertsProvider } from '@/components/AlertsProvider';
import { AdminProvider } from '@/components/AdminProvider';
import { loadNotify } from '@/lib/alerts/notify-context';
import { NavTabs } from '@/components/NavTabs';
import { BrandMark } from '@/components/Icons';
import '@/styles/sharing.css';
import '@/styles/admin.css';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect('/login');

  const notify = await loadNotify(ctx.supabase, ctx.user, ctx.companyId);

  const { count: pendingMail } = await ctx.supabase
    .from('email_outbox')
    .select('id', { count: 'exact', head: true })
    .in('status', ['pending', 'drafted']);

  return (
    <AdminProvider isAdmin={ctx.isAdmin}>
    <EmailsProvider companyId={ctx.companyId} initialPending={pendingMail ?? 0}>
    <AlertsProvider companyId={ctx.companyId} initialUnread={notify.unread} initialNotify={notify.ctx} initialReads={notify.reads}>
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand">
            <BrandMark size={30} />
            Automatización con IA
          </span>
          <NavTabs isAdmin={ctx.isAdmin} />
          <form action="/auth/signout" method="post" className="signout">
            <button className="btn ghost">Salir</button>
          </form>
        </div>
      </header>
      <main className="container">{children}</main>
    </AlertsProvider>
    </EmailsProvider>
    </AdminProvider>
  );
}
