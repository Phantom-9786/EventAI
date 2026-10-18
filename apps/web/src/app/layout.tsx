import type { Metadata, Viewport } from 'next';
import { AuthProvider } from '@/components/auth/auth-provider';
import { MaintenanceGuard } from '@/components/layout/maintenance-guard';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import './globals.css';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  title: {
    default: 'EventAI — Discover. Book. Experience.',
    template: '%s | EventAI',
  },
  description:
    'AI-powered event discovery and ticket booking platform. Find events, book tickets, and experience more.',
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
      <body className="flex min-h-screen flex-col font-sans">
        <AuthProvider>
          <MaintenanceGuard>
            <Header />
            <main className="flex-1">{children}</main>
            <Footer />
          </MaintenanceGuard>
        </AuthProvider>
      </body>
    </html>
  );
}
