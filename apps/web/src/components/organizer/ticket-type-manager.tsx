'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import {
  createOrganizerTicketType,
  deleteOrganizerTicketType,
  updateOrganizerTicketType,
  type OrganizerEventDetail,
  type OrganizerTicketType,
  type OrganizerTicketTypeInput,
} from '@/lib/organizer';
import { formatPrice } from '@/lib/api';

function toLocalDateTime(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function TicketTypeForm({
  ticket,
  onSave,
  onCancel,
}: {
  ticket?: OrganizerTicketType;
  onSave: (input: OrganizerTicketTypeInput & { isActive?: boolean }) => Promise<void>;
  onCancel?: () => void;
}) {
  const sold = ticket ? ticket.totalQuantity - ticket.availableQuantity : 0;
  const [name, setName] = useState(ticket?.name ?? '');
  const [description, setDescription] = useState(ticket?.description ?? '');
  const [price, setPrice] = useState(ticket ? (ticket.price / 100).toFixed(2) : '');
  const [quantity, setQuantity] = useState(String(ticket?.totalQuantity ?? 1));
  const [maxPerBooking, setMaxPerBooking] = useState(String(ticket?.maxPerBooking ?? 5));
  const [saleStart, setSaleStart] = useState(toLocalDateTime(ticket?.saleStartDate ?? null));
  const [saleEnd, setSaleEnd] = useState(toLocalDateTime(ticket?.saleEndDate ?? null));
  const [isActive, setIsActive] = useState(ticket?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const numericPrice = Number(price);
    const numericQuantity = Number(quantity);
    const numericMax = Number(maxPerBooking);
    if (!Number.isFinite(numericPrice) || numericPrice < 0 || numericPrice * 100 > Number.MAX_SAFE_INTEGER) {
      setError('Enter a valid non-negative price in rupees.');
      return;
    }
    if (!Number.isInteger(numericQuantity) || numericQuantity < Math.max(1, sold)) {
      setError(`Inventory must be a whole number of at least ${Math.max(1, sold)} (already sold: ${sold}).`);
      return;
    }
    if (!Number.isInteger(numericMax) || numericMax < 1 || numericMax > 10) {
      setError('Maximum per booking must be between 1 and 10.');
      return;
    }
    const start = saleStart ? new Date(saleStart) : null;
    const end = saleEnd ? new Date(saleEnd) : null;
    if (start && end && end <= start) {
      setError('The sale end must be after the sale start.');
      return;
    }

    const input: OrganizerTicketTypeInput & { isActive?: boolean } = {
      name: name.trim(),
      description: description.trim() || undefined,
      price: Math.round(numericPrice * 100),
      totalQuantity: numericQuantity,
      maxPerBooking: numericMax,
      saleStartDate: start?.toISOString(),
      saleEndDate: end?.toISOString(),
      ...(ticket ? { isActive } : {}),
    };
    setSaving(true);
    try {
      await onSave(input);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the ticket type.');
    } finally {
      setSaving(false);
    }
  }

  const inputClass = 'mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm';
  return (
    <form onSubmit={submit} className="ep-surface-inset space-y-4 rounded-md border p-4">
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium">Ticket name<input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} /></label>
        <label className="text-sm font-medium">Price (INR)<input required type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className={inputClass} /></label>
        <label className="text-sm font-medium">Total inventory<input required type="number" min={Math.max(1, sold)} step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inputClass} /></label>
        <label className="text-sm font-medium">Maximum per booking<input required type="number" min="1" max="10" step="1" value={maxPerBooking} onChange={(e) => setMaxPerBooking(e.target.value)} className={inputClass} /></label>
        <div className="col-span-full grid gap-4 sm:grid-cols-2">
          <DateTimePicker
            label="Sale starts (optional)"
            value={saleStart}
            onChange={setSaleStart}
            showQuickChips={false}
          />
          <DateTimePicker
            label="Sale ends (optional)"
            value={saleEnd}
            onChange={setSaleEnd}
            showQuickChips={false}
          />
        </div>
      </div>
      <label className="block text-sm font-medium">Description (optional)<textarea maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></label>
      {ticket && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />Available for sale</label>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : ticket ? 'Save ticket type' : 'Add ticket type'}</Button>
        {onCancel && <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>}
      </div>
    </form>
  );
}

export function TicketTypeManager({ event }: { event: OrganizerEventDetail }) {
  const [tickets, setTickets] = useState<OrganizerTicketType[]>(event.ticketTypes ?? []);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const blocked = event.status === 'CANCELLED' || event.status === 'COMPLETED';

  async function create(input: OrganizerTicketTypeInput & { isActive?: boolean }) {
    const created = await createOrganizerTicketType(event.id, input);
    setTickets((current) => [...current, created].sort((a, b) => a.price - b.price));
    setNotice('Ticket type added.');
    setError(null);
  }

  async function update(id: string, input: OrganizerTicketTypeInput & { isActive?: boolean }) {
    const updated = await updateOrganizerTicketType(id, input);
    setTickets((current) => current.map((ticket) => ticket.id === id ? updated : ticket).sort((a, b) => a.price - b.price));
    setEditing(null);
    setNotice('Ticket type saved.');
    setError(null);
  }

  async function remove(ticket: OrganizerTicketType) {
    if (!window.confirm(`Delete “${ticket.name}”? This removes the ticket type permanently.`)) return;
    setError(null);
    setNotice(null);
    try {
      await deleteOrganizerTicketType(ticket.id);
      setTickets((current) => current.filter((item) => item.id !== ticket.id));
      setNotice('Ticket type deleted.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the ticket type.');
    }
  }

  return (
    <section className="mt-10" aria-labelledby="ticket-types-heading">
      <h2 id="ticket-types-heading" className="text-xl font-semibold">Ticket types and inventory</h2>
      <p className="mt-1 text-sm text-muted-foreground">Prices are entered in rupees. Sold tickets cannot be removed or reduced from inventory.</p>
      {error && <p role="alert" className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="mt-4 rounded-md border border-green-600/30 bg-green-600/10 px-3 py-2 text-sm">{notice}</p>}
      <div className="mt-4 space-y-4">
          {tickets.length === 0 && <p className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">No ticket types yet.</p>}
          {tickets.map((ticket) => {
            const sold = ticket.totalQuantity - ticket.availableQuantity;
            return (
              <article key={ticket.id} className="rounded-lg border bg-card p-4">
                {editing === ticket.id ? (
                  <TicketTypeForm ticket={ticket} onSave={(input) => update(ticket.id, input)} onCancel={() => setEditing(null)} />
                ) : (
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold">{ticket.name}</h3>
                        <span className={`rounded-full px-2 py-0.5 text-xs ${ticket.isActive ? 'bg-green-600/10 text-green-700' : 'bg-muted text-muted-foreground'}`}>{ticket.isActive ? 'Active' : 'Inactive'}</span>
                      </div>
                      {ticket.description && <p className="mt-1 text-sm text-muted-foreground">{ticket.description}</p>}
                      <p className="mt-2 text-sm">{formatPrice(ticket.price)} · {sold} sold · {ticket.availableQuantity} available · {ticket.totalQuantity} total · max {ticket.maxPerBooking}/booking</p>
                      {(ticket.saleStartDate || ticket.saleEndDate) && <p className="mt-1 text-xs text-muted-foreground">Sale window: {ticket.saleStartDate ? new Date(ticket.saleStartDate).toLocaleString() : 'Any time'} – {ticket.saleEndDate ? new Date(ticket.saleEndDate).toLocaleString() : 'No end'}</p>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setEditing(ticket.id)}>Edit</Button>
                      {sold === 0 && <Button type="button" variant="destructive" size="sm" onClick={() => void remove(ticket)}>Delete</Button>}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
          {!blocked && <TicketTypeForm onSave={create} />}
          {blocked && <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Ticket types cannot be added to cancelled or completed events.</p>}
      </div>
    </section>
  );
}
