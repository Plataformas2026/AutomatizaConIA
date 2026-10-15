'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export interface EmailToast {
  id: string;
  ruleName: string;
  fileName: string;
  sheetName: string | null;
  rowNumber: number | null;
  /** El correo tiene un problema (p. ej. falta el destinatario) y hay que revisarlo a mano. */
  problem: boolean;
}

interface EmailsContextValue {
  /** Correos pendientes de revisar o enviar. */
  pending: number;
  refreshPending: () => Promise<void>;
  toasts: EmailToast[];
  dismissToast: (id: string) => void;
}

const EmailsContext = createContext<EmailsContextValue | null>(null);

export function useEmails(): EmailsContextValue {
  const ctx = useContext(EmailsContext);
  if (!ctx) throw new Error('useEmails debe usarse dentro de <EmailsProvider>');
  return ctx;
}

const MAX_TOASTS = 3;
const TOAST_MS = 9000;

interface OutboxPayload {
  id: string;
  status: string;
  rule_name: string | null;
  file_name: string | null;
  sheet_name: string | null;
  row_number: number | null;
  problem: string | null;
}

/**
 * Una sola suscripción Realtime para los correos pendientes de la empresa (RLS: solo los tuyos).
 * Del correo solo se usan el nombre de la regla, del archivo y la fila para el aviso: ni asunto ni texto.
 */
export function EmailsProvider({ companyId, initialPending, children }: { companyId: string; initialPending: number; children: React.ReactNode }) {
  const [pending, setPending] = useState(initialPending);
  const [toasts, setToasts] = useState<EmailToast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const seen = useRef(new Set<string>());
  const router = useRouter();
  const pathname = usePathname();
  const onEmailsPage = useRef(false);
  onEmailsPage.current = pathname.startsWith('/emails');

  const refreshPending = useCallback(async () => {
    const { count, error } = await createClient()
      .from('email_outbox')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .in('status', ['pending', 'drafted']);
    if (!error && count !== null) setPending(count);
  }, [companyId]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`emails-live:${companyId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'email_outbox', filter: `company_id=eq.${companyId}` },
        (payload) => {
          const o = payload.new as OutboxPayload;
          if (seen.current.has(o.id) || !['pending', 'drafted'].includes(o.status)) return;
          seen.current.add(o.id);
          setPending((n) => n + 1);
          if (onEmailsPage.current) router.refresh(); // la lista de la pestaña se actualiza sola
          setToasts((prev) =>
            [
              { id: o.id, ruleName: o.rule_name ?? '', fileName: o.file_name ?? '', sheetName: o.sheet_name, rowNumber: o.row_number, problem: !!o.problem },
              ...prev,
            ].slice(0, MAX_TOASTS),
          );
          timers.current.set(o.id, setTimeout(() => dismissToast(o.id), TOAST_MS));
        },
      )
      // Enviado, descartado o enviado por el agente: el contador se corrige con el número real.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'email_outbox', filter: `company_id=eq.${companyId}` }, () => {
        void refreshPending();
        if (onEmailsPage.current) router.refresh();
      })
      .subscribe();

    const onFocus = () => void refreshPending();
    window.addEventListener('focus', onFocus);
    const pendingTimers = timers.current;
    return () => {
      window.removeEventListener('focus', onFocus);
      void supabase.removeChannel(channel);
      pendingTimers.forEach((t) => clearTimeout(t));
      pendingTimers.clear();
    };
  }, [companyId, dismissToast, refreshPending, router]);

  const value = useMemo(() => ({ pending, refreshPending, toasts, dismissToast }), [pending, refreshPending, toasts, dismissToast]);
  return <EmailsContext.Provider value={value}>{children}</EmailsContext.Provider>;
}
