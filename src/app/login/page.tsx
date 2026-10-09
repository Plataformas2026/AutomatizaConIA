'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState('sending');
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setState('error');
      setMessage(error.message);
    } else {
      setState('sent');
    }
  }

  return (
    <main className="center">
      <div className="card">
        <h1>Drive Alerts</h1>
        <p className="sub">Te enviamos un enlace de acceso por correo. Sin contraseñas.</p>

        {state === 'sent' ? (
          <p>
            Revisa tu bandeja de <strong>{email}</strong> y abre el enlace desde este mismo navegador.
          </p>
        ) : (
          <form onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="email">Correo de la empresa</label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <button className="btn primary" disabled={state === 'sending'} style={{ width: '100%' }}>
              {state === 'sending' ? 'Enviando…' : 'Enviar enlace de acceso'}
            </button>
            {state === 'error' && <p className="err">{message}</p>}
          </form>
        )}
      </div>
    </main>
  );
}
