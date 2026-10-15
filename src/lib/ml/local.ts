import { StatsError } from '@/lib/stats/compute';
import { pickTable, sheetsOf } from '@/lib/stats/local';
import { runMl } from './run';
import type { MlConfig, MlResult } from './types';

/**
 * Informes y modelos IA con un archivo LOCAL. El agente de este ordenador entrega la tabla al navegador y el
 * modelo se entrena aquí, con el mismo código que usa el servidor para Drive (`runMl`: determinista, mismos
 * datos → mismo informe). Nada pasa por Supabase ni por Vercel y no se guarda: la tabla vive en la memoria
 * de la pestaña un minuto como máximo.
 */
export async function localMl(config: MlConfig): Promise<MlResult> {
  const sheets = await sheetsOf(config.fileId);
  const table = pickTable(sheets, config.sheet);
  // Deja que el navegador pinte «Analizando…» antes de empezar el cálculo.
  await new Promise((r) => setTimeout(r, 30));
  try {
    return runMl(table, config);
  } catch (e) {
    if (e instanceof StatsError) throw e;
    throw new StatsError('read_error', 500);
  }
}
