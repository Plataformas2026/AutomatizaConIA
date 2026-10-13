import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionContext } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Borra un informe propio. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!z.string().uuid().safeParse(reportId).success) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { error } = await ctx.supabase.from('ml_reports').delete().eq('id', reportId);
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
