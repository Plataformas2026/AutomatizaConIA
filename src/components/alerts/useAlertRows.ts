'use client';

import { useEffect, useState } from 'react';
import { loadAlertRows, type AlertRowsData } from '@/lib/alerts/rows';

export type AlertRowsState =
  | { status: 'loading' }
  | { status: 'ok'; data: AlertRowsData }
  | { status: 'error'; message: string };

/** Carga (una vez por alerta abierta) el contenido de las filas que dispararon la alerta. No se guarda en ningún sitio. */
export function useAlertRows(alertId: string): AlertRowsState {
  const [state, setState] = useState<AlertRowsState>({ status: 'loading' });
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    loadAlertRows(alertId)
      .then((data) => alive && setState({ status: 'ok', data }))
      .catch((e: unknown) =>
        alive && setState({ status: 'error', message: e instanceof Error && e.message ? e.message : 'No se pudo leer el contenido de las filas.' }),
      );
    return () => {
      alive = false;
    };
  }, [alertId]);
  return state;
}
