'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ToastViewport } from './Toasts';

export interface AlertRow {
  id: string;
  file_name: string;
  rule_name: string;
  sheet_name: string | null;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  matched_count: number;
  row_refs: number[];
  status: 'open' | 'read' | 'dismissed';
  created_at: string;
}

export interface ToastItem {
  id: string;
  alert: AlertRow;
}

interface AlertsContextValue {
  /** Alertas sin leer (estado «open»). */
  unread: number;
  /** Suma o resta al contador al instante (p. ej. al marcar una alerta como leída). */
  adjustUnread: (delta: number) => void;
  /** Vuelve a pedir el contador real al servidor. */
  refreshUnread: () => Promise<void>;
  /** Para que una lista en pantalla reciba las alertas nuevas sin abrir otra suscripción. */
  onNewAlert: (fn: (a: AlertRow) => void) => () => void;
  toasts: ToastItem[];
  dismissToast: (id: string) => void;
}

const AlertsContext = createContext<AlertsContextValue | null>(null);

export function useAlerts(): AlertsContextValue {
  const ctx = useContext(AlertsContext);
  if (!ctx) throw new Error('useAlerts debe usarse dentro de <AlertsProvider>');
  return ctx;
}

const MAX_TOASTS = 4;
const TOAST_MS = 9000;

/**
 * Mantiene UNA suscripción Realtime para toda la zona privada. Las filas llegan
 * filtradas por RLS: solo se reciben alertas de tu empresa.
 */
export function AlertsProvider({
  companyId,
  initialUnread,
  children,
}: {
  companyId: string;
  initialUnread: number;
  children: React.ReactNode;
}) {
  const [unread, setUnread] = useState(initialUnread);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const listeners = useRef(new Set<(a: AlertRow) => void>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const seen = useRef(new Set<string>());

  const adjustUnread = useCallback((delta: number) => setUnread((n) => Math.max(0, n + delta)), []);

  const refreshUnread = useCallback(async () => {
    const { count, error } = await createClient()
      .from('alerts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open');
    if (!error && count !== null) setUnread(count);
  }, []);

  const onNewAlert = useCallback((fn: (a: AlertRow) => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`alerts-live:${companyId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'alerts', filter: `company_id=eq.${companyId}` },
        (payload) => {
          const alert = payload.new as AlertRow;
          if (seen.current.has(alert.id)) return; // evita duplicados por reconexiones
          seen.current.add(alert.id);

          if (alert.status === 'open') setUnread((n) => n + 1);
          listeners.current.forEach((fn) => fn(alert));

          setToasts((prev) => [{ id: alert.id, alert }, ...prev].slice(0, MAX_TOASTS));
          timers.current.set(
            alert.id,
            setTimeout(() => dismissToast(alert.id), TOAST_MS),
          );
        },
      )
      .subscribe();

    // Si se marcaron alertas como leídas desde otra pestaña, el contador se corrige al volver.
    const onFocus = () => void refreshUnread();
    window.addEventListener('focus', onFocus);

    const pending = timers.current;
    return () => {
      window.removeEventListener('focus', onFocus);
      void supabase.removeChannel(channel);
      pending.forEach((t) => clearTimeout(t));
      pending.clear();
    };
  }, [companyId, dismissToast, refreshUnread]);

  // El título de la pestaña del navegador también avisa: «(3) Automatización con IA».
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\+?\)\s*/, '');
    document.title = unread > 0 ? `(${unread > 99 ? '99+' : unread}) ${base}` : base;
  }, [unread]);

  const value = useMemo(
    () => ({ unread, adjustUnread, refreshUnread, onNewAlert, toasts, dismissToast }),
    [unread, adjustUnread, refreshUnread, onNewAlert, toasts, dismissToast],
  );

  return (
    <AlertsContext.Provider value={value}>
      {children}
      <ToastViewport />
    </AlertsContext.Provider>
  );
}
