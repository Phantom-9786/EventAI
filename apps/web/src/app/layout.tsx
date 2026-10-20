import type { Metadata, Viewport } from 'next';
import { AuthProvider } from '@/components/auth/auth-provider';
import { MaintenanceGuard } from '@/components/layout/maintenance-guard';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { WorkspaceShell } from '@/components/layout/workspace-shell';
import './globals.css';
import './approved-preview.css';
import './ui-scale.css';
import './light-surfaces.css';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
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
          <MaintenanceGuard>
            <Header />
            <main className="flex-1"><WorkspaceShell>{children}</WorkspaceShell></main>
            <Footer />
          </MaintenanceGuard>
        </AuthProvider>
      </body>
    </html>
  );
}
