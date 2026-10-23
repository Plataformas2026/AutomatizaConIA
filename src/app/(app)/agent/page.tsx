import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionContext } from '@/lib/auth';
import { loadAgentCards } from '@/lib/agents/load';
import { AgentManager } from '@/components/local/AgentManager';

export default async function AgentPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect('/login');
  const agents = await loadAgentCards(ctx);

  return (
    <>
      <p className="back">
        <Link href="/dashboard">← Volver al Dashboard</Link>
      </p>
      <h1>Agente local</h1>
      <p className="sub">
        Para vigilar archivos de tu ordenador <strong>sin subirlos a ninguna nube</strong>, instalas un pequeño programa
        en tu PC. Lee tus archivos allí mismo, aplica tus reglas y envía solo los avisos.
      </p>

      <AgentManager
        agents={agents}
        supabaseUrl={process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''}
        anonKey={process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''}
      />
    </>
  );
}
