import type { Metadata, Viewport } from 'next';
import { AuthProvider } from '@/components/auth/auth-provider';
import { MaintenanceGuard } from '@/components/layout/maintenance-guard';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { WorkspaceShell } from '@/components/layout/workspace-shell';
import { AdminPendingProvider } from '@/components/admin/pending-counts';
import './globals.css';
import './approved-preview.css';
import './ui-scale.css';
import './light-surfaces.css';
import './mobile-layout.css';
import './dashboard-charts.css';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  icons: {
    icon: [
      { url: '/icon.svg?v=2', type: 'image/svg+xml', sizes: 'any' },
      { url: '/eventpoint-favicon-32.png', type: 'image/png', sizes: '32x32' },
    ],
    shortcut: '/eventpoint-favicon-32.png',
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  title: {
    default: 'EventPoint — Discover. Book. Experience.',
    template: '%s | EventPoint',
  },
  description:
    'EventPoint — Discover amazing events, book instant digital tickets, and experience unforgettable moments.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('eventai_theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="ep-app flex min-h-screen flex-col">
        <AuthProvider>
          <AdminPendingProvider>
            <MaintenanceGuard>
              <Header />
              <main className="flex-1"><WorkspaceShell>{children}</WorkspaceShell></main>
              <Footer />
            </MaintenanceGuard>
          </AdminPendingProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
