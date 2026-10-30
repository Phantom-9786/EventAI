'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from '@/components/ui/app-link';
import { useSearchParams } from 'next/navigation';
import {
  Camera,
  CameraOff,
  CheckCircle2,
  ChevronLeft,
  Download,
  Loader2,
  ScanLine,
  Search,
  Ticket,
  XCircle,
} from 'lucide-react';
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
import { cn } from '@/lib/utils';

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
  const [attendeeSearch, setAttendeeSearch] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const scanningRef = useRef(false);
  const cameraSession = useRef(0);

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
          message: `Admitted: ${result.ticket.holderName || result.holder.email}`,
          detail: `${result.ticket.ticketType.name} · Code ${result.ticket.ticketCode} · Checked in successfully`,
        });
        setCode('');
        void refreshEvent(eventId);
      } catch (err) {
        setOutcome({
          kind: 'error',
          message: 'Entry Refused',
          detail: err instanceof Error ? err.message : 'Invalid or expired ticket code',
        });
      } finally {
        setBusy(false);
      }
    },
    [eventId, busy, refreshEvent],
  );

  const stopCamera = useCallback(() => {
    cameraSession.current += 1;
    scanningRef.current = false;
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  }, []);

  const startCamera = useCallback(async () => {
    stopCamera();
    const session = cameraSession.current;
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera access requires HTTPS and a supported browser. Open this page in Chrome or Safari, or enter the ticket code.');
      return;
    }
    setCameraOn(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } } });
      if (session !== cameraSession.current) { stream.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) { stopCamera(); return; }
      video.srcObject = stream;
      await video.play();
      if (session !== cameraSession.current) return;
      const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
      let detector: BarcodeDetectorLike | null = null;
      try { if (ctor) detector = new ctor({ formats: ['qr_code'] }); } catch { /* Use the portable decoder. */ }
      let decode: typeof import('jsqr').default | null = detector ? null : (await import('jsqr')).default;
      if (session !== cameraSession.current) return;
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { willReadFrequently: true });
      scanningRef.current = true;
      let lastFrame = 0;
      const tick = async () => {
        if (!scanningRef.current || session !== cameraSession.current) return;
        if (video.readyState < 2 || performance.now() - lastFrame < 180) {
          rafRef.current = requestAnimationFrame(() => void tick()); return;
        }
        lastFrame = performance.now();
        try {
          let raw: string | undefined;
          if (detector) raw = (await detector.detect(video))[0]?.rawValue;
          else if (context && decode && video.videoWidth > 0) {
            canvas.width = Math.min(640, video.videoWidth);
            canvas.height = Math.round(canvas.width * video.videoHeight / video.videoWidth);
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const frame = context.getImageData(0, 0, canvas.width, canvas.height);
            raw = decode(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' })?.data;
          }
          if (session !== cameraSession.current) return;
          if (raw) {
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
          // Some browsers expose BarcodeDetector but cannot scan QR video frames.
          if (detector) { detector = null; decode = (await import('jsqr')).default; }
        }
        if (session === cameraSession.current) rafRef.current = requestAnimationFrame(() => void tick());
      };
      void tick();
    } catch (error) {
      if (session !== cameraSession.current) return;
      const name = error instanceof Error ? error.name : '';
      setCameraError(name === 'NotAllowedError'
        ? 'Camera permission was denied. Allow camera access in your browser settings, then try again.'
        : name === 'NotReadableError' ? 'The camera is busy. Close other camera apps and try again.'
          : 'Unable to start the camera. Try another browser or enter the ticket code.');
      stopCamera();
    }
  }, [handleValidate, stopCamera]);

  useEffect(() => () => stopCamera(), [stopCamera]);
  useEffect(() => { stopCamera(); }, [eventId, stopCamera]);
  useEffect(() => {
    const pause = () => { if (document.visibilityState === 'hidden') stopCamera(); };
    document.addEventListener('visibilitychange', pause);
    return () => document.removeEventListener('visibilitychange', pause);
  }, [stopCamera]);

  // Filter attendees by search query
  const filteredAttendees = useMemo(() => {
    if (!attendees) return [];
    if (!attendeeSearch.trim()) return attendees;
    const q = attendeeSearch.toLowerCase();
    return attendees.filter((b) => {
      const name = `${b.user.firstName ?? ''} ${b.user.lastName ?? ''}`.toLowerCase();
      const email = b.user.email.toLowerCase();
      const hasItem = b.items.some((i) => i.ticketType.name.toLowerCase().includes(q));
      return name.includes(q) || email.includes(q) || hasItem || b.id.toLowerCase().includes(q);
    });
  }, [attendees, attendeeSearch]);

  const handleExportCsv = () => {
    if (!filteredAttendees || filteredAttendees.length === 0) return;
    const headers = ['Booking ID', 'First Name', 'Last Name', 'Email', 'Items', 'Status', 'Total Amount'];
    const rows = filteredAttendees.map((b) => [
      b.id,
      b.user.firstName ?? '',
      b.user.lastName ?? '',
      b.user.email,
      b.items.map((i) => `${i.quantity}x ${i.ticketType.name}`).join('; '),
      b.status,
      b.totalAmount,
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `attendees-${eventId || 'event'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

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
        <h1 className="text-xl font-semibold">Sign in to access door scanner</h1>
        <Link href="/signin?returnUrl=/dashboard/scan" className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
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
          Go to Organizer Hub
        </Link>
      </div>
    );
  }

  const selectedEvent = events?.find((e) => e.id === eventId);

  return (
    <div className="container ep-scanner-page py-8 sm:py-10 max-w-5xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ScanLine className="h-4 w-4" />
            </span>
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">
              Gate Check-in
            </span>
          </div>
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            Door Admission Scanner
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Scan attendee QR passes with camera or validate codes manually.
          </p>
        </div>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-lg border border-border/80 bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Back to Dashboard
        </Link>
      </div>

      {!events || events.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border/80 p-12 text-center bg-card/40">
          <Ticket className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 text-base font-semibold">No events found</p>
          <p className="mt-1 text-xs text-muted-foreground">
            You must create and publish an event before using the admission scanner.
          </p>
          <Link href="/organizer/events/new" className="mt-4 inline-block rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground">
            Create Event
          </Link>
        </div>
      ) : (
        <>
          {/* Event Picker Bar */}
          <div className="mt-6 flex flex-col gap-2 rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex-1 max-w-md">
              <label htmlFor="event" className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Active Event
              </label>
              <select
                id="event"
                value={eventId}
                onChange={(e) => {
                  setEventId(e.target.value);
                  setOutcome(null);
                }}
                className="h-10 w-full rounded-xl border border-border/80 bg-background px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title} ({formatEventDate(e.startDate)})
                  </option>
                ))}
              </select>
            </div>
            {selectedEvent && (
              <div className="text-xs text-muted-foreground sm:text-right">
                <p className="font-semibold text-foreground">{selectedEvent.venue.name}</p>
                <p>{selectedEvent.venue.city}</p>
              </div>
            )}
          </div>

          {/* Stats Counters */}
          {stats && (
            <div className="mt-6 grid grid-cols-3 gap-3 sm:gap-4">
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-center">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  Checked In
                </p>
                <p className="mt-1 text-2xl sm:text-3xl font-bold text-emerald-600 dark:text-emerald-400">
                  {stats.checkedIn}
                </p>
              </div>
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-center">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                  Awaiting Entry
                </p>
                <p className="mt-1 text-2xl sm:text-3xl font-bold text-amber-600 dark:text-amber-400">
                  {stats.VALID}
                </p>
              </div>
              <div className="rounded-2xl border border-border/80 bg-card p-4 text-center">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Total Issued
                </p>
                <p className="mt-1 text-2xl sm:text-3xl font-bold text-foreground">
                  {stats.total}
                </p>
              </div>
            </div>
          )}

          {/* Main Scanner Card with Camera Viewfinder */}
          <div className="mt-6 rounded-2xl border border-border/80 bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-2 font-semibold text-foreground text-sm">
                <ScanLine className="h-4 w-4 text-primary" />
                Admission Pass Validation
              </p>
              <span className="text-[11px] text-muted-foreground">
                Supports camera QR scanning & manual code entry
              </span>
            </div>

            <form
              className="mt-4 flex flex-col sm:flex-row gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void handleValidate(code);
              }}
            >
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Scan or enter ticket code (e.g. TKT-…)"
                autoComplete="off"
                className="h-11 flex-1 rounded-xl border border-border/80 bg-background px-4 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary shadow-sm"
              />
              <div className="flex items-center gap-2">
                <Button type="submit" disabled={busy || !code.trim()} className="h-11 px-5 font-semibold">
                  {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                  Admit Pass
                </Button>
                {cameraOn ? (
                  <Button type="button" variant="outline" onClick={stopCamera} className="h-11 gap-1.5">
                    <CameraOff className="h-4 w-4" /> Stop Camera
                  </Button>
                ) : (
                  <Button type="button" variant="outline" onClick={() => void startCamera()} className="h-11 gap-1.5">
                    <Camera className="h-4 w-4 text-primary" /> Scan QR
                  </Button>
                )}
              </div>
            </form>

            {/* Camera Viewfinder with animated laser bracket */}
              <div style={{ display: cameraOn ? 'flex' : 'none' }} className="relative mt-4 overflow-hidden rounded-2xl border border-primary/40 bg-black aspect-video max-h-[380px] w-full items-center justify-center">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />

                {/* Viewfinder Target Frame Overlay */}
                <div className="pointer-events-none absolute h-52 w-52 rounded-xl border-2 border-primary/60 shadow-[0_0_20px_rgba(79,70,229,0.3)]">
                  {/* Viewfinder Corner Accents */}
                  <div className="absolute -top-1 -left-1 h-5 w-5 border-t-4 border-l-4 border-cyan-400" />
                  <div className="absolute -top-1 -right-1 h-5 w-5 border-t-4 border-r-4 border-cyan-400" />
                  <div className="absolute -bottom-1 -left-1 h-5 w-5 border-b-4 border-l-4 border-cyan-400" />
                  <div className="absolute -bottom-1 -right-1 h-5 w-5 border-b-4 border-r-4 border-cyan-400" />
                  {/* Laser scan line */}
                  <div className="absolute inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_#22d3ee] animate-pulse" />
                </div>
                <div className="absolute bottom-3 rounded-full bg-black/75 px-3 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
                  Point camera at attendee QR pass
                </div>
              </div>
            {cameraError && (
              <p className="mt-3 text-xs text-destructive">{cameraError}</p>
            )}

            {/* Outcome Result Alert */}
            {outcome && (
              <div
                role="status"
                className={cn(
                  'mt-4 flex items-start gap-3 rounded-xl border p-4 text-sm',
                  outcome.kind === 'success'
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
                    : 'border-destructive/40 bg-destructive/10 text-destructive',
                )}
              >
                {outcome.kind === 'success' ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <XCircle className="mt-0.5 h-5 w-5 shrink-0" />
                )}
                <div>
                  <p className="font-bold">{outcome.message}</p>
                  <p className="mt-0.5 text-xs opacity-90">{outcome.detail}</p>
                </div>
              </div>
            )}
          </div>

          {/* Attendee Roster Section */}
          <div className="mt-10">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-foreground">
                  Attendee Roster ({filteredAttendees.length})
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Guest list for door admission and verified check-in reconciliation.
                </p>
              </div>

              <div className="ep-scanner-roster-tools flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    value={attendeeSearch}
                    onChange={(e) => setAttendeeSearch(e.target.value)}
                    placeholder="Search attendee or ticket…"
                    className="h-9 w-48 sm:w-60 rounded-xl border border-border/80 bg-background pl-8 pr-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportCsv}
                  disabled={!filteredAttendees || filteredAttendees.length === 0}
                  className="h-9 gap-1.5 text-xs font-medium"
                >
                  <Download className="h-3.5 w-3.5" /> Export CSV
                </Button>
              </div>
            </div>

            {!attendees || attendees.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-border/80 p-8 text-center text-xs text-muted-foreground bg-card/40">
                No bookings for this event yet.
              </div>
            ) : filteredAttendees.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-border/80 p-8 text-center text-xs text-muted-foreground bg-card/40">
                No attendees match &quot;{attendeeSearch}&quot;.
              </div>
            ) : (
              <div className="mt-4 overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-border/80 bg-muted/40 uppercase tracking-wider text-muted-foreground font-semibold">
                      <tr>
                        <th className="px-4 py-3">Attendee</th>
                        <th className="px-4 py-3">Tickets & Tier</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {filteredAttendees.map((b) => (
                        <tr key={b.id} className="transition-colors hover:bg-muted/20">
                          <td className="px-4 py-3">
                            <p className="font-semibold text-foreground">
                              {[b.user.firstName, b.user.lastName].filter(Boolean).join(' ') || 'Attendee'}
                            </p>
                            <p className="text-[11px] text-muted-foreground">{b.user.email}</p>
                            <p className="font-mono text-[10px] text-muted-foreground/70">ID: {b.id.slice(0, 8)}…</p>
                          </td>
                          <td className="px-4 py-3">
                            {b.items.map((item) => (
                              <p key={item.ticketType.id} className="font-medium text-foreground">
                                {item.quantity} × {item.ticketType.name}
                              </p>
                            ))}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={cn(
                                'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold',
                                b.status === 'CONFIRMED'
                                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                                  : b.status === 'REFUNDED'
                                    ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20'
                                    : 'bg-muted text-muted-foreground border border-border',
                              )}
                            >
                              {b.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-foreground">
                            {formatPrice(b.totalAmount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
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
