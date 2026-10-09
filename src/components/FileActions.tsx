'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function FileActions({ fileId }: { fileId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!confirm('¿Dejar de vigilar este archivo? Se borrarán sus reglas. Tu archivo en Drive no se toca.')) return;
    setBusy(true);
    await fetch(`/api/files/${fileId}`, { method: 'DELETE' });
    setBusy(false);
    router.refresh();
  }

  return (
    <button className="btn danger" onClick={remove} disabled={busy}>
      Dejar de compartir
    </button>
  );
}
