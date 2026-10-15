'use client';

import { useId } from 'react';
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
  // value might be "2026-10-25T19:00" or ISO string
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
      // default to today's date if date not yet selected
      const today = new Date().toISOString().slice(0, 10);
      onChange(`${today}T${newTime}`);
      return;
    }
    onChange(`${date}T${newTime}`);
  };

  const formattedPreview = date && time ? formatPreview(date, time) : '';

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor={`${id}-date`} className="block text-sm font-medium">
          {label} {required && <span className="text-destructive">*</span>}
        </label>
        {formattedPreview && (
          <span className="text-xs font-medium text-primary">
            {formattedPreview}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {/* Date input */}
        <div className="relative">
          <input
            id={`${id}-date`}
            type="date"
            required={required}
            disabled={disabled}
            min={minDate}
            value={date}
            onChange={(e) => handleDateChange(e.target.value)}
            className={cn(
              'h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
              error && 'border-destructive focus-visible:ring-destructive',
            )}
          />
        </div>

        {/* Time input + select */}
        <div className="flex gap-1.5">
          <input
            id={`${id}-time`}
            type="time"
            required={required}
            disabled={disabled}
            value={time}
            onChange={(e) => handleTimeChange(e.target.value)}
            className={cn(
              'h-10 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
              error && 'border-destructive focus-visible:ring-destructive',
            )}
          />
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
