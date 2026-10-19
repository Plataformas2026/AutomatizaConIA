'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ToastViewport } from './Toasts';
import { loadNotify } from '@/lib/alerts/notify-context';
import { handoffKey, isRelevant, isUnread, type NotifyContext } from '@/lib/alerts/relevance';
import type { Chains, Handoffs } from '@/lib/assign/assign';

export interface AlertRow {
  id: string;
  file_name: string;
  rule_name: string;
  sheet_name: string | null;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  matched_count: number;
  row_refs: number[];
  /** Reparto por persona: { huella: { n, rows } }. Nunca nombres ni correos. */
  assignees?: Record<string, { n: number; rows: number[] }> | null;
  /** Tareas con varios nombres («ana / luis»): { fila: [huellas] }. */
  chains?: Chains | null;
  /** «assigned» = a quien le toca; «everyone» = a todos los del proyecto. */
  audience?: 'assigned' | 'everyone' | null;
  /** Sube cada vez que una tarea cambia de manos; la alerta vuelve a salir como no leída. */
  rev?: number | null;
  rule_id?: string | null;
  file_id?: string | null;
  /** Plantilla que se rellena con «Rellenar». */
  template_id?: string | null;
  status: 'open' | 'read' | 'dismissed';
  created_at: string;
  /** Proyecto al que pertenece la alerta (vinculado a través de su archivo). */
  project_id?: string | null;
  /** Solo en la pestaña Alertas: nombre del proyecto y si es de un proyecto compartido conmigo. */
  project_name?: string | null;
  shared?: boolean;
  company_id?: string | null;
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
  /** Vuelve a calcular el contador real (mis avisos, con mis lecturas). */
  refreshUnread: () => Promise<void>;
  /** Mi contexto de avisos (nombres, proyectos con «todos», tareas traspasadas) y mis lecturas. */
  notify: NotifyContext;
  reads: Record<string, number>;
  /** Marca como leídas (para mí solo) estas alertas. */
  markRead: (ids: string[]) => Promise<boolean>;
  /** ¿Está sin leer para mí? */
  isUnreadFor: (a: AlertRow) => boolean;
  /** Para que la lista reciba cambios de alertas existentes (traspasos, descartes). */
  onAlertChange: (fn: (a: AlertRow) => void) => () => void;
  /** Vuelve a pedir las tareas traspasadas de una regla (tras pasar o devolver una tarea). */
  reloadHandoffs: (ruleId: string) => Promise<void>;
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
 * filtradas por RLS: tu empresa y los proyectos compartidos contigo (solo cuentan las que te tocan).
 */
export function AlertsProvider({
  companyId,
  initialUnread,
  initialNotify,
  initialReads,
  children,
}: {
  companyId: string;
  initialUnread: number;
  initialNotify: NotifyContext;
  initialReads: Record<string, number>;
  children: React.ReactNode;
}) {
  const [unread, setUnread] = useState(initialUnread);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const listeners = useRef(new Set<(a: AlertRow) => void>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const seen = useRef(new Map<string, number>()); // alerta → última rev vista (evita duplicados)
  const changeListeners = useRef(new Set<(a: AlertRow) => void>());
  const [notify, setNotify] = useState<NotifyContext>(initialNotify);
  const [reads, setReads] = useState<Record<string, number>>(initialReads);
  const notifyRef = useRef(notify);
  const readsRef = useRef(reads);
  notifyRef.current = notify;
  readsRef.current = reads;

  const adjustUnread = useCallback((delta: number) => setUnread((n) => Math.max(0, n + delta)), []);

  const refreshUnread = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    const r = await loadNotify(supabase, { id: data.user.id, email: data.user.email }, companyId);
    setNotify(r.ctx);
    setReads(r.reads);
    setUnread(r.unread);
  }, [companyId]);

  const markRead = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return true;
      const { error } = await createClient().rpc('mark_alerts_read', { p_ids: ids });
      if (error) return false;
      await refreshUnread();
      return true;
    },
    [refreshUnread],
  );

  const isUnreadFor = useCallback((a: AlertRow) => isUnread({ ...a, status: a.status }, reads), [reads]);

  const onAlertChange = useCallback((fn: (a: AlertRow) => void) => {
    changeListeners.current.add(fn);
    return () => {
      changeListeners.current.delete(fn);
    };
  }, []);

  const reloadHandoffs = useCallback(async (ruleId: string) => {
    const { data } = await createClient().from('row_handoffs').select('sheet, row_number, level').eq('rule_id', ruleId);
    setNotify((prev) => {
      const next = { ...prev, handoffs: { ...prev.handoffs } };
      for (const k of Object.keys(next.handoffs)) if (k.startsWith(`${ruleId}|`)) delete next.handoffs[k];
      for (const h of data ?? []) ((next.handoffs[handoffKey(ruleId, h.sheet as string)] ??= {}) as Handoffs)[h.row_number as number] = h.level as number;
      return next;
    });
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
      // Sin filtro de empresa: RLS solo entrega lo que puedo ver (mi empresa y los proyectos compartidos conmigo).
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, async (payload) => {
        if (payload.eventType === 'DELETE') return;
        const alert = payload.new as AlertRow;
        const prevRev = seen.current.get(alert.id);
        const rev = alert.rev ?? 0;
        if (prevRev !== undefined && rev <= prevRev) {
          changeListeners.current.forEach((fn) => fn(alert)); // descartada, etc.
          return;
        }
        seen.current.set(alert.id, rev);
        if (payload.eventType === 'UPDATE' && alert.rule_id) await reloadHandoffs(alert.rule_id);
        const relevant = await isRelevant({ ...alert, status: alert.status }, notifyRef.current);
        const fresh = isUnread({ ...alert, status: alert.status }, readsRef.current);
        if (payload.eventType === 'INSERT') listeners.current.forEach((fn) => fn(alert));
        else changeListeners.current.forEach((fn) => fn(alert));
        if (!relevant || !fresh) return;
        if (payload.eventType === 'UPDATE' && prevRev === undefined) return; // cambio de una alerta que no conocía
        setUnread((n) => n + 1);
        setToasts((prev) => [{ id: `${alert.id}:${rev}`, alert }, ...prev].slice(0, MAX_TOASTS));
        timers.current.set(`${alert.id}:${rev}`, setTimeout(() => dismissToast(`${alert.id}:${rev}`), TOAST_MS));
      })
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
  }, [companyId, dismissToast, refreshUnread, reloadHandoffs]);

  // El título de la pestaña del navegador también avisa: «(3) Automatización con IA».
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\+?\)\s*/, '');
    document.title = unread > 0 ? `(${unread > 99 ? '99+' : unread}) ${base}` : base;
  }, [unread]);

  const value = useMemo(
    () => ({ unread, adjustUnread, refreshUnread, notify, reads, markRead, isUnreadFor, onAlertChange, reloadHandoffs, onNewAlert, toasts, dismissToast }),
    [unread, adjustUnread, refreshUnread, notify, reads, markRead, isUnreadFor, onAlertChange, reloadHandoffs, onNewAlert, toasts, dismissToast],
  );

  return (
    <AlertsContext.Provider value={value}>
      {children}
      <ToastViewport />
    </AlertsContext.Provider>
  );
}
