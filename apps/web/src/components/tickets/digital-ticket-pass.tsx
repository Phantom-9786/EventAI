'use client';

import { useEffect, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  Copy,
  Download,
  MapPin,
  QrCode,
  Share2,
  Ticket as TicketIcon,
  Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getTicketQr } from '@/lib/booking';
import { formatEventDate } from '@/lib/api';
import { cn } from '@/lib/utils';

export interface DigitalTicketProps {
  ticket: {
    id: string;
    ticketCode: string;
    holderName?: string | null;
    status: string;
    ticketType?: {
      name: string;
      price?: number;
    };
  };
  event: {
    title: string;
    slug: string;
    startDate: string;
    venue: {
      name: string;
      city: string;
      address?: string | null;
    };
  };
  qrDataUrl?: string | null;
  bookingRef: string;
}

export function DigitalTicketPass({ ticket, event, qrDataUrl: initialQr, bookingRef }: DigitalTicketProps) {
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState<string | null>(initialQr ?? null);
  const [qrFailed, setQrFailed] = useState(false);

  useEffect(() => {
    if (initialQr) {
      setQr(initialQr);
      return;
    }
    if (ticket.status !== 'VALID') return;

    let cancelled = false;
    getTicketQr(ticket.id)
      .then((dataUrl) => {
        if (!cancelled) setQr(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setQrFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [ticket.id, ticket.status, initialQr]);

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(ticket.ticketCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  const handleCalendar = () => {
    const escape = (value: string) => value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
    const date = new Date(event.startDate).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const text = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//EventPoint//Events//EN', 'BEGIN:VEVENT', 'UID:' + escape(bookingRef) + '@eventpoint.local', 'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''), 'DTSTART:' + date, 'SUMMARY:' + escape(event.title), 'LOCATION:' + escape(event.venue.name + ', ' + event.venue.city), 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'eventpoint-event.ics'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handlePrint = () => {
    if (typeof window !== 'undefined') {
      window.print();
    }
  };

  const handleShare = async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: `Admission Pass: ${event.title}`,
          text: `Here is my admission ticket (${ticket.ticketCode}) for ${event.title} at ${event.venue.name}.`,
          url: window.location.href,
        });
      } catch {
        // User cancelled or unsupported
      }
    } else {
      void handleCopyCode();
    }
  };

  const isValid = ticket.status === 'VALID';

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border/80 bg-card/95 shadow-lg backdrop-blur-sm transition-all hover:border-primary/40 hover:shadow-primary/5">
      {/* Top ambient banner gradient */}
      <div className="h-2 w-full bg-gradient-to-r from-primary via-emerald-500 to-indigo-500 opacity-80" />

      <div className="flex flex-col md:flex-row">
        {/* Left / Main Pass Section */}
        <div className="flex-1 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                <TicketIcon className="h-3 w-3" />
                {ticket.ticketType?.name ?? 'Standard Admission'}
              </span>
              <h3 className="mt-2 text-lg font-bold tracking-tight text-foreground sm:text-xl line-clamp-1">
                {event.title}
              </h3>
            </div>
            <div className="text-right">
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
                  isValid
                    ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'border border-muted bg-muted text-muted-foreground',
                )}
              >
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    isValid ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground',
                  )}
                />
                {ticket.status}
              </span>
            </div>
          </div>

          {/* Details grid */}
          <div className="mt-5 grid grid-cols-2 gap-4 border-t border-border/60 pt-4 sm:grid-cols-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Date & Time</p>
              <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-foreground">
                <CalendarDays className="h-3.5 w-3.5 text-primary shrink-0" />
                {formatEventDate(event.startDate)}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Venue</p>
              <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-foreground truncate">
                <MapPin className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="truncate">{event.venue.name}, {event.venue.city}</span>
              </p>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Ticket Holder</p>
              <p className="mt-1 text-xs font-semibold text-foreground truncate">
                {ticket.holderName || 'Attendee'}
              </p>
            </div>
          </div>

          {/* Pass Action bar */}
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
            <Button variant="outline" size="sm" onClick={handleCalendar} className="gap-2"><CalendarDays size={16} />Add to calendar</Button>
            <Button
              variant="outline"
              size="sm"
              disabled title="Wallet passes require issuer configuration before they can be issued"
              className="h-8 gap-1.5 text-xs font-medium"
            >
              <Wallet className="h-3.5 w-3.5 text-muted-foreground" />
              Wallet not configured
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrint}
              className="h-8 gap-1.5 text-xs font-medium"
            >
              <Download className="h-3.5 w-3.5 text-muted-foreground" />
              Print Pass
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleShare}
              className="h-8 gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <Share2 className="h-3.5 w-3.5" />
              Share
            </Button>
          </div>
        </div>

        {/* Perforated divider with notch cutouts */}
        <div className="relative flex flex-row md:flex-col items-center justify-center">
          {/* Top/Left notch cutout */}
          <div className="hidden md:block -mt-3 h-6 w-6 rounded-full bg-background border border-border/80" />
          {/* Dashed vertical divider for desktop */}
          <div className="hidden md:block h-full w-[1px] border-l-2 border-dashed border-border/80" />
          {/* Dashed horizontal divider for mobile */}
          <div className="md:hidden w-full border-t-2 border-dashed border-border/80 my-2" />
          {/* Bottom/Right notch cutout */}
          <div className="hidden md:block -mb-3 h-6 w-6 rounded-full bg-background border border-border/80" />
        </div>

        {/* Right / QR & Barcode Section */}
        <div className="flex flex-col items-center justify-center bg-muted/20 p-5 sm:p-6 md:w-56 text-center border-t md:border-t-0 md:border-l border-border/60">
          <div className="relative group/qr">
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qr}
                alt={`QR code for ticket ${ticket.ticketCode}`}
                className="h-28 w-28 rounded-xl border border-border/80 bg-white p-1.5 shadow-md transition-transform group-hover/qr:scale-105"
              />
            ) : qrFailed ? (
              <div className="flex h-28 w-28 items-center justify-center rounded-xl border border-dashed border-border/80 bg-muted/50 text-xs text-muted-foreground p-2">
                QR unavailable
              </div>
            ) : (
              <div className="flex h-28 w-28 items-center justify-center rounded-xl border border-dashed border-border/80 bg-muted/50 text-muted-foreground animate-pulse">
                <QrCode className="h-10 w-10 opacity-40" />
              </div>
            )}
          </div>

          <div className="mt-3">
            <button
              type="button"
              onClick={handleCopyCode}
              title="Click to copy ticket code"
              className="group/code flex items-center justify-center gap-1 font-mono text-xs font-bold tracking-wider text-foreground hover:text-primary transition-colors"
            >
              <span>{ticket.ticketCode}</span>
              {copied ? (
                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
              ) : (
                <Copy className="h-3 w-3 opacity-60 group-hover/code:opacity-100" />
              )}
            </button>
            <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              Scan at gate entry
            </p>
            <p className="mt-0.5 text-[10px] text-muted-foreground/80 font-mono">
              Ref: #{bookingRef.slice(0, 8)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
