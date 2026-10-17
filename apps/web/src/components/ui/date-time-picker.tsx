'use client';

import { useId } from 'react';
import { Calendar, Clock, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DateTimePickerProps {
  label: string;
  value: string; // ISO string or 'YYYY-MM-DDTHH:mm'
  onChange: (value: string) => void;
  minDate?: string;
  error?: string | null;
  helperText?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  showQuickChips?: boolean;
}

const COMMON_TIMES = [
  '09:00',
  '10:00',
  '11:00',
  '12:00',
  '13:00',
  '14:00',
  '15:00',
  '16:00',
  '17:00',
  '18:00',
  '19:00',
  '20:00',
  '21:00',
  '22:00',
];

function parseValue(value: string) {
  if (!value) return { date: '', time: '18:00' };
  const [datePart, timePart] = value.split('T');
  const time = timePart ? timePart.slice(0, 5) : '18:00';
  return { date: datePart ?? '', time };
}

function formatPreview(dateStr: string, timeStr: string): string {
  if (!dateStr) return '';
  try {
    const [year, month, day] = dateStr.split('-').map(Number);
    const [hours, minutes] = timeStr.split(':').map(Number);
    const date = new Date(year, month - 1, day, hours, minutes);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('en-IN', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  } catch {
    return '';
  }
}

function getQuickDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function getUpcomingWeekend(): string {
  const d = new Date();
  const day = d.getDay(); // 0 is Sun, 6 is Sat
  const daysUntilSaturday = day === 6 ? 7 : (6 - day);
  d.setDate(d.getDate() + daysUntilSaturday);
  return d.toISOString().slice(0, 10);
}

export function DateTimePicker({
  label,
  value,
  onChange,
  minDate,
  error,
  helperText,
  disabled = false,
  required = false,
  id: customId,
  showQuickChips = true,
}: DateTimePickerProps) {
  const generatedId = useId();
  const id = customId ?? generatedId;
  const { date, time } = parseValue(value);

  const handleDateChange = (newDate: string) => {
    if (!newDate) {
      onChange('');
      return;
    }
    onChange(`${newDate}T${time || '18:00'}`);
  };

  const handleTimeChange = (newTime: string) => {
    if (!date) {
      const today = new Date().toISOString().slice(0, 10);
      onChange(`${today}T${newTime}`);
      return;
    }
    onChange(`${date}T${newTime}`);
  };

  const formattedPreview = date && time ? formatPreview(date, time) : '';

  const quickChips = [
    { label: 'Today', getDate: () => getQuickDate(0) },
    { label: 'Tomorrow', getDate: () => getQuickDate(1) },
    { label: 'This Weekend', getDate: () => getUpcomingWeekend() },
    { label: '+1 Week', getDate: () => getQuickDate(7) },
  ];

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <label htmlFor={`${id}-date`} className="block text-sm font-medium text-foreground">
          {label} {required && <span className="text-destructive">*</span>}
        </label>
        {formattedPreview && (
          <span className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
            <Clock className="h-3 w-3" aria-hidden="true" />
            {formattedPreview}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {/* Date input with icon */}
        <div className="relative">
          <Calendar className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <input
            id={`${id}-date`}
            type="date"
            required={required}
            disabled={disabled}
            min={minDate}
            value={date}
            onChange={(e) => handleDateChange(e.target.value)}
            className={cn(
              'h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
              error && 'border-destructive focus-visible:ring-destructive',
            )}
          />
        </div>

        {/* Time input + select presets */}
        <div className="flex gap-1.5">
          <div className="relative flex-1">
            <Clock className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <input
              id={`${id}-time`}
              type="time"
              required={required}
              disabled={disabled}
              value={time}
              onChange={(e) => handleTimeChange(e.target.value)}
              className={cn(
                'h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
                error && 'border-destructive focus-visible:ring-destructive',
              )}
            />
          </div>
          <select
            aria-label="Preset times"
            disabled={disabled}
            value={COMMON_TIMES.includes(time) ? time : ''}
            onChange={(e) => {
              if (e.target.value) handleTimeChange(e.target.value);
            }}
            className="h-10 rounded-md border border-input bg-background px-2 text-xs text-muted-foreground shadow-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">Presets</option>
            {COMMON_TIMES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Quick date chips */}
      {showQuickChips && !disabled && (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Sparkles className="h-2.5 w-2.5" aria-hidden="true" /> Quick:
          </span>
          {quickChips.map((chip) => {
            const chipDate = chip.getDate();
            const isSelected = date === chipDate;
            const isBeforeMin = minDate ? chipDate < minDate : false;
            if (isBeforeMin) return null;
            return (
              <button
                key={chip.label}
                type="button"
                onClick={() => handleDateChange(chipDate)}
                className={cn(
                  'rounded border px-2 py-0.5 text-[11px] transition-colors',
                  isSelected
                    ? 'border-primary bg-primary text-primary-foreground font-medium'
                    : 'border-input bg-muted/30 text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      )}

      {error ? (
        <p role="alert" className="text-xs text-destructive font-medium">
          {error}
        </p>
      ) : helperText ? (
        <p className="text-xs text-muted-foreground">{helperText}</p>
      ) : null}
    </div>
  );
}
