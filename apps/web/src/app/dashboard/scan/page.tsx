'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Camera, CameraOff, CheckCircle2, Loader2, ScanLine, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/auth/auth-provider';
import { useOrganizerDashboard } from '@/lib/organizer';
import {
  getEventAttendees,
  getEventTicketStats,
  validateTicketCode,
  type AttendeeBooking,
  type TicketStats,
} from '@/lib/organizer';
import { formatEventDate, formatPrice } from '@/lib/api';

interface BarcodeDetectorLike {
  detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]>;
}
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike;

type ScanOutcome =
  | { kind: 'success'; message: string; detail: string }
  | { kind: 'error'; message: string; detail: string };

function ScannerInner() {
  const { user, loading: authLoading } = useAuth();
  const { events, profile, loading: dashLoading } = useOrganizerDashboard(!!user);
  const searchParams = useSearchParams();
  const [eventId, setEventId] = useState<string>('');
  const [stats, setStats] = useState<TicketStats | null>(null);
  const [attendees, setAttendees] = useState<AttendeeBooking[] | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const scanningRef = useRef(false);

  const refreshEvent = useCallback(async (id: string) => {
    try {
      const [s, a] = await Promise.all([getEventTicketStats(id), getEventAttendees(id)]);
      setStats(s);
      setAttendees(a.bookings);
    } catch {
      setStats(null);
      setAttendees(null);
    }
  }, []);

  useEffect(() => {
    if (!events || events.length === 0) return;
    const fromQuery = searchParams.get('event');
    const valid = fromQuery && events.some((e) => e.id === fromQuery) ? fromQuery : events[0].id;
    setEventId((cur) => cur || valid);
  }, [events, searchParams]);

  useEffect(() => {
    if (eventId) void refreshEvent(eventId);
  }, [eventId, refreshEvent]);

  const handleValidate = useCallback(
    async (rawCode: string) => {
      const trimmed = rawCode.trim();
      if (!eventId || !trimmed || busy) return;
      setBusy(true);
      try {
        const result = await validateTicketCode(eventId, trimmed);
        setOutcome({
          kind: 'success',
          message: `Welcome, ${result.ticket.holderName || result.holder.email}`,
          detail: `${result.ticket.ticketType.name} · ${result.ticket.ticketCode} · checked in`,
        });
        setCode('');
        void refreshEvent(eventId);
      } catch (err) {
        setOutcome({
          kind: 'error',
          message: 'Ticket refused',
          detail: err instanceof Error ? err.message : 'Unknown error',
        });
      } finally {
        setBusy(false);
      }
    },
    [eventId, busy, refreshEvent],
  );

  const stopCamera = useCallback(() => {
    scanningRef.current = false;
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    if (!('BarcodeDetector' in window)) {
      setCameraError('Camera QR scanning is not supported in this browser — use manual code entry.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      setCameraOn(true);
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
      if (!ctor) {
        setCameraError('QR detection is unavailable in this browser.');
        stopCamera();
        return;
      }
      const detector = new ctor({ formats: ['qr_code'] });
      scanningRef.current = true;
      const tick = async () => {
        if (!scanningRef.current || !video) return;
        try {
          const codes = await detector.detect(video);
          if (codes.length > 0) {
            const raw = codes[0].rawValue;
            let code = raw;
            try {
              const parsed = JSON.parse(raw) as { code?: string };
              if (parsed.code) code = parsed.code;
            } catch {
              /* not JSON — treat the raw value as the code */
            }
            scanningRef.current = false;
            stopCamera();
            void handleValidate(code);
            return;
          }
        } catch {
          /* transient detection errors are ignored */
        }
        rafRef.current = requestAnimationFrame(() => void tick());
      };
      void tick();
    } catch {
      setCameraError('Camera access was denied or unavailable.');
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setCameraOn(false);
    }
  }, [handleValidate, stopCamera]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  if (authLoading || (dashLoading && !events)) {
    return (
      <div className="container flex justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container flex max-w-md flex-col items-center py-24 text-center">
        <h1 className="text-xl font-semibold">Sign in to scan tickets</h1>
        <Link href="/signin" className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          Sign In
        </Link>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="container max-w-md py-16 text-center">
        <h1 className="text-xl font-semibold">Become an organizer first</h1>
        <Link href="/dashboard" className="mt-6 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          Go to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="container py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Door scanner</h1>
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
          ← Dashboard
        </Link>
      </div>

      {!events || events.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No events yet — create an event before using the scanner.
        </p>
      ) : (
        <>
          <div className="mt-6 flex max-w-md flex-col gap-1.5">
            <label htmlFor="event" className="text-sm font-medium">Event</label>
            <select
              id="event"
              value={eventId}
              onChange={(e) => {
                setEventId(e.target.value);
                setOutcome(null);
              }}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title} — {formatEventDate(e.startDate)}
                </option>
              ))}
            </select>
          </div>

          {stats && (
            <div className="mt-6 grid max-w-lg grid-cols-3 gap-4">
              <div className="rounded-lg border bg-card p-4 text-center shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Checked in</p>
                <p className="mt-1 text-2xl font-bold text-green-600 dark:text-green-400">{stats.checkedIn}</p>
              </div>
              <div className="rounded-lg border bg-card p-4 text-center shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Awaiting</p>
                <p className="mt-1 text-2xl font-bold">{stats.VALID}</p>
              </div>
              <div className="rounded-lg border bg-card p-4 text-center shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total tickets</p>
                <p className="mt-1 text-2xl font-bold">{stats.total}</p>
              </div>
            </div>
          )}

          <div className="mt-8 max-w-xl rounded-lg border bg-card p-6 shadow-sm">
            <p className="flex items-center gap-2 font-medium">
              <ScanLine className="h-4 w-4" /> Check in a ticket
            </p>
            <form
              className="mt-4 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void handleValidate(code);
              }}
            >
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="TKT-…"
                autoComplete="off"
                className="h-10 flex-1 rounded-md border border-input bg-background px-3 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button type="submit" disabled={busy || !code.trim()}>
                {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                Check in
              </Button>
              {cameraOn ? (
                <Button type="button" variant="outline" onClick={stopCamera}>
                  <CameraOff className="mr-1 h-4 w-4" /> Stop camera
                </Button>
              ) : (
                <Button type="button" variant="outline" onClick={() => void startCamera()}>
                  <Camera className="mr-1 h-4 w-4" /> Scan QR
                </Button>
              )}
            </form>

            {cameraOn && (
              <div className="mt-4 overflow-hidden rounded-md border">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video ref={videoRef} className="aspect-video w-full bg-black object-cover" muted playsInline />
              </div>
            )}
            {cameraError && <p className="mt-2 text-sm text-muted-foreground">{cameraError}</p>}

            {outcome && (
              <div
                role="status"
                className={`mt-4 flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
                  outcome.kind === 'success'
                    ? 'border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300'
                    : 'border-destructive/40 bg-destructive/10 text-destructive'
                }`}
              >
                {outcome.kind === 'success' ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <span>
                  <span className="font-semibold">{outcome.message}</span>
                  <span className="block text-xs opacity-80">{outcome.detail}</span>
                </span>
              </div>
            )}
          </div>

          <h2 className="mt-10 text-xl font-semibold">Attendees</h2>
          {!attendees || attendees.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No bookings for this event yet.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Attendee</th>
                    <th className="px-4 py-2.5 font-medium">Tickets</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 text-right font-medium">Paid</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {attendees.map((b) => (
                    <tr key={b.id}>
                      <td className="px-4 py-2.5">
                        <p className="font-medium">
                          {[b.user.firstName, b.user.lastName].filter(Boolean).join(' ') || b.user.email}
                        </p>
                        <p className="text-xs text-muted-foreground">{b.user.email}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        {b.items.map((item) => (
                          <p key={item.ticketType.id} className="text-xs">
                            {item.quantity} × {item.ticketType.name}
                          </p>
                        ))}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`w-fit rounded-full px-2 py-0.5 text-xs font-medium ${
                            b.status === 'CONFIRMED'
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                              : b.status === 'REFUNDED'
                                ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                                : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {b.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">{formatPrice(b.totalAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function ScannerPage() {
  return (
    <Suspense
      fallback={
        <div className="container flex justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <ScannerInner />
    </Suspense>
  );
}
