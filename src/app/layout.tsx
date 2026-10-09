import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Drive Alerts',
  description: 'Alertas en tiempo real sobre tus hojas de Google Drive, sin copiar tus datos.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
