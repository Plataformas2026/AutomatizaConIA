import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionContext } from '@/lib/auth';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect('/login');

  const { count } = await ctx.supabase
    .from('alerts')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'open');

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand">Drive Alerts</span>
          <nav className="tabs">
            <Link className="tab" href="/dashboard">
              Archivos
            </Link>
            <Link className="tab" href="/alerts">
              Alertas{count ? <span className="badge">{count}</span> : null}
            </Link>
          </nav>
          <form action="/auth/signout" method="post">
            <button className="btn">Salir</button>
          </form>
        </div>
      </header>
      <main className="container">{children}</main>
    </>
  );
}
