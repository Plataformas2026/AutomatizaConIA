import { redirect } from 'next/navigation';
import { getSessionContext } from '@/lib/auth';
import { AlertsProvider } from '@/components/AlertsProvider';
import { NavTabs } from '@/components/NavTabs';
import { BrandMark } from '@/components/Icons';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect('/login');

  const { count } = await ctx.supabase
    .from('alerts')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'open');

  return (
    <AlertsProvider companyId={ctx.companyId} initialUnread={count ?? 0}>
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand">
            <BrandMark size={30} />
            Drive Alerts
          </span>
          <NavTabs />
          <form action="/auth/signout" method="post" className="signout">
            <button className="btn ghost">Salir</button>
          </form>
        </div>
      </header>
      <main className="container">{children}</main>
    </AlertsProvider>
  );
}
