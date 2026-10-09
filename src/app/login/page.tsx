'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { BrandMark } from '@/components/Icons';

type Mode = 'login' | 'register';

const MIN_PASSWORD = 8;
const GENERIC_ERROR = 'No se pudo completar la operación. Inténtalo de nuevo.';

function friendlyError(code: string | undefined): string {
  switch (code) {
    case 'invalid_credentials':
      return 'Correo o contraseña incorrectos.';
    case 'email_not_confirmed':
      return 'Tu correo aún no está confirmado.';
    case 'user_already_exists':
      return 'Ya existe una cuenta con ese correo. Inicia sesión.';
    case 'signup_disabled':
      return 'El registro está desactivado. Pide a un administrador que cree tu cuenta.';
    case 'weak_password':
      return `La contraseña es demasiado débil. Usa al menos ${MIN_PASSWORD} caracteres.`;
    case 'over_request_rate_limit':
      return 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.';
    case 'over_email_send_rate_limit':
      return 'Se ha superado el límite de correos de confirmación. Inténtalo más tarde.';
    default:
      return GENERIC_ERROR;
  }
}

type Mode = 'login' | 'register';

const MIN_PASSWORD = 8;
const GENERIC_ERROR = 'No se pudo completar la operación. Inténtalo de nuevo.';

function friendlyError(code: string | undefined): string {
  switch (code) {
    case 'invalid_credentials':
      return 'Correo o contraseña incorrectos.';
    case 'email_not_confirmed':
      return 'Tu correo aún no está confirmado.';
    case 'user_already_exists':
      return 'Ya existe una cuenta con ese correo. Inicia sesión.';
    case 'signup_disabled':
      return 'El registro está desactivado. Pide a un administrador que cree tu cuenta.';
    case 'weak_password':
      return `La contraseña es demasiado débil. Usa al menos ${MIN_PASSWORD} caracteres.`;
    case 'over_request_rate_limit':
      return 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.';
    case 'over_email_send_rate_limit':
      return 'Se ha superado el límite de correos de confirmación. Inténtalo más tarde.';
    default:
      return GENERIC_ERROR;
  }
}

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (mode === 'register' && password.length < MIN_PASSWORD) {
      setError(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`);
      return;
    }

    setBusy(true);
    const supabase = createClient();
    const cleanEmail = email.trim();

    if (mode === 'login') {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });
      if (authError) {
        setError(friendlyError(authError.code));
        setBusy(false);
        return;
      }
      // Navegación completa: garantiza que el servidor ve ya las cookies de sesión.
      window.location.assign('/dashboard');
      return;
    }

    const { data, error: authError } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
    });
    if (authError) {
      setError(friendlyError(authError.code));
      setBusy(false);
      return;
    }
    // Con "Confirm email" activado, Supabase no da error si el correo ya existe:
    // devuelve un usuario sin identidades.
    if (data.user && data.user.identities?.length === 0) {
      setError('Ya existe una cuenta con ese correo. Inicia sesión.');
      setBusy(false);
      return;
    }
    // Con "Confirm email" desactivado, signUp devuelve sesión y entramos directamente.
    if (data.session) {
      window.location.assign('/dashboard');
      return;
    }
    setInfo('Cuenta creada. Revisa tu correo para confirmarla y después inicia sesión.');
    setMode('login');
    setPassword('');
    setBusy(false);
  }

  function switchMode() {
    setMode(mode === 'login' ? 'register' : 'login');
    setError(null);
    setInfo(null);
  }

  return (
    <main className="center">
<<<<<<< HEAD
      <div className="card">
        <h1>Drive Alerts</h1>
=======
      <div className="login-card">
        <div className="login-brand">
          <BrandMark size={44} />
          <h1>Drive Alerts</h1>
        </div>
>>>>>>> 88ca893 (Cambios de navegación, estéticos y de importación)
        <p className="sub">
          {mode === 'login' ? 'Inicia sesión con tu correo y contraseña.' : 'Crea tu cuenta con correo y contraseña.'}
        </p>

        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="email">Correo electrónico</label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="password">Contraseña</label>
            <input
              id="password"
              type="password"
              required
              minLength={mode === 'register' ? MIN_PASSWORD : undefined}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {mode === 'register' && <span className="muted">Mínimo {MIN_PASSWORD} caracteres.</span>}
          </div>

          <button className="btn primary" disabled={busy} style={{ width: '100%' }}>
            {busy ? 'Un momento…' : mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
          </button>

          {error && (
            <p className="err" role="alert">
              {error}
            </p>
          )}
          {info && <p className="muted">{info}</p>}
        </form>

        <p className="muted" style={{ marginTop: 16, textAlign: 'center' }}>
          {mode === 'login' ? '¿No tienes cuenta?' : '¿Ya tienes cuenta?'}{' '}
<<<<<<< HEAD
          <button
            type="button"
            onClick={switchMode}
            style={{ all: 'unset', color: 'var(--accent)', cursor: 'pointer' }}
          >
=======
          <button type="button" onClick={switchMode} className="linkbtn">
>>>>>>> 88ca893 (Cambios de navegación, estéticos y de importación)
            {mode === 'login' ? 'Crear una' : 'Iniciar sesión'}
          </button>
        </p>
      </div>
    </main>
  );
}
