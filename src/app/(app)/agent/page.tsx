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
        en tu PC. Lee tus archivos allí mismo, aplica tus reglas y envía solo los avisos (texto y nº de fila).
      </p>

      <AgentManager
        agents={agents}
        supabaseUrl={process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''}
        anonKey={process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''}
      />

      <section className="panel" aria-labelledby="howto-title">
        <h2 id="howto-title">Cómo ponerlo en marcha</h2>
        <ol className="howto">
          <li>Crea un agente aquí arriba y copia el bloque de configuración que aparece (solo se muestra una vez).</li>
          <li>
            En tu PC instala Python y la carpeta <code>agent</code> del proyecto, y guarda el bloque como{' '}
            <code>.env</code> dentro de ella.
          </li>
          <li>Programa el agente en el Programador de tareas de Windows para que arranque solo.</li>
          <li>Vuelve al Dashboard y elige los archivos que quieres vigilar.</li>
        </ol>
        <p className="muted">
          El paso a paso detallado está en <code>agent/README.md</code>. Cuando el agente arranque, verás aquí «Conectado».
        </p>
      </section>
    </>
  );
}
