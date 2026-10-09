import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Automatización con IA',
  description:
    'Automatización con IA: alertas en tiempo real y estadísticas sobre tus hojas de Google Drive, sin copiar tus datos.',
  applicationName: 'Automatización con IA',
  openGraph: {
    title: 'Automatización con IA',
    siteName: 'Automatización con IA',
    description: 'Alertas en tiempo real y estadísticas sobre tus hojas de Google Drive, sin copiar tus datos.',
    locale: 'es_ES',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
