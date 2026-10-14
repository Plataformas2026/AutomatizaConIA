import { redirect } from 'next/navigation';
import { getSessionContext } from '@/lib/auth';
import { AdminPanel } from '@/components/admin/AdminPanel';

export const dynamic = 'force-dynamic';

/** Administración: solo para administradores de la plataforma (comprobado en la base de datos). */
export default async function AdminPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect('/login');
  if (!ctx.isAdmin) redirect('/dashboard');

  return (
    <>
      <div className="page-title">
        <h1>Administración</h1>
      </div>
      <p className="sub">
        Elige a una persona para crear, editar y asignar sus proyectos y archivos, o para gestionar sus reglas. Cada acción queda registrada.
      </p>
      <AdminPanel />
    </>
  );
}
