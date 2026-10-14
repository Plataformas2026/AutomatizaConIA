import { NextResponse } from 'next/server';
import { getSessionContext } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Lista de usuarios para los selectores de administración. Solo administradores (lo comprueba la propia función SQL). */
export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!ctx.isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { data, error } = await ctx.supabase.rpc('admin_list_users');
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  const users = ((data ?? []) as { user_id: string; email: string; company_id: string; company_name: string }[]).map((u) => ({
    userId: u.user_id,
    email: u.email,
    companyId: u.company_id,
    companyName: u.company_name,
    isMe: u.user_id === ctx.user.id,
  }));
  return NextResponse.json({ users });
}
