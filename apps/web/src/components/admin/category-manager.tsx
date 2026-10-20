'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { EventImage } from '@/components/approved/event-image';
import { categorySpotlightCopy, categorySpotlightCover } from '@/lib/category-spotlights';
import { createAdminCategory, deactivateAdminCategory, updateAdminCategoryCover, uploadAdminCategoryCover, type AdminCategory } from '@/lib/admin';

function useFilePreview(file: File | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) { setUrl(null); return; }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

function CoverInput({ id, file, onChange, required, disabled }: {
  id: string; file: File | null; onChange: (file: File | null) => void; required?: boolean; disabled: boolean;
}) {
  const [error, setError] = useState('');
  return <div className="ep-category-file">
    <label htmlFor={id}>Category cover image{required ? ' *' : ''}</label>
    <input id={id} type="file" accept="image/jpeg,image/png,image/webp" required={required} disabled={disabled}
      onChange={e => {
        const chosen = e.target.files?.[0] ?? null;
        if (chosen && (!['image/jpeg', 'image/png', 'image/webp'].includes(chosen.type) || chosen.size > 5 * 1024 * 1024)) {
          setError('Choose a JPEG, PNG, or WebP image up to 5 MB.');
          e.target.value = ''; onChange(null); return;
        }
        setError(''); onChange(chosen);
      }} />
    <p>Use a clear landscape photo, ideally 1600 × 900, without text. JPEG, PNG or WebP · up to 5 MB.</p>
    {file && <p>{file.name}</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </div>;
}

function CoverPreview({ category, url }: { category: { name: string; slug: string }; url: string | null | undefined }) {
  const wording = categorySpotlightCopy(category);
  return <div className="spotlight ep-category-cover-preview">
    <EventImage src={url} alt={`${category.name || 'New category'} cover`} className="ep-spotlight-cover" />
    <div><span className="eyebrow">{wording.eyebrow}</span><h3>{wording.title}</h3><p>{wording.description}</p></div>
  </div>;
}

export function CategoryManager({ categories, busy, onAction }: {
  categories: AdminCategory[]; busy: boolean; onAction: (fn: () => Promise<void>) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#6366F1');
  const [createFile, setCreateFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [selected, setSelected] = useState<{ category: AdminCategory; edit: boolean } | null>(null);
  const [replacement, setReplacement] = useState<File | null>(null);
  const [coverError, setCoverError] = useState('');
  const createPreview = useFilePreview(createFile);
  const replacementPreview = useFilePreview(replacement);
  const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return <section className="panel ep-category-manager" aria-labelledby="category-manager-title">
    <h2 id="category-manager-title">Event categories</h2>
    <p className="help">Set a cover for each category. The two homepage spotlights are chosen automatically by paid ticket sales.</p>
    <form className="ep-category-create" onSubmit={e => {
      e.preventDefault();
      if (!createFile) return;
      void onAction(async () => {
        const coverImage = await uploadAdminCategoryCover(createFile);
        await createAdminCategory({ name: name.trim(), color, coverImage });
        setName(''); setCreateFile(null); setInputKey(key => key + 1);
      });
    }}>
      <div className="ep-category-name-fields">
        <label>Category name<input required minLength={2} maxLength={50} value={name} disabled={busy} onChange={e => setName(e.target.value)} placeholder="e.g. Dance" /></label>
        <label>Accent<input type="color" value={color} disabled={busy} onChange={e => setColor(e.target.value)} /></label>
      </div>
      <CoverInput key={inputKey} id="new-category-cover" file={createFile} onChange={setCreateFile} required disabled={busy} />
      {createPreview && <CoverPreview category={{ name: name || 'Your category', slug }} url={createPreview} />}
      <Button type="submit" disabled={busy || !createFile || name.trim().length < 2}>{busy ? 'Saving…' : 'Create category'}</Button>
    </form>
    <div className="ep-category-list">
      {categories.length === 0 && <p>No active categories yet.</p>}
      {categories.map(category => <div key={category.id} className="ep-category-row">
        <div className="ep-category-summary">
          <EventImage src={categorySpotlightCover(category)} alt={`${category.name} cover`} className="ep-category-thumbnail" />
          <div><strong>{category.name}</strong><p>/{category.slug} · {category.eventCount} published events</p></div>
        </div>
        <div className="ep-actions">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => { setCoverError(''); setReplacement(null); setSelected({ category, edit: false }); }}>Preview cover</Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => { setCoverError(''); setReplacement(null); setSelected({ category, edit: true }); }}>Change cover</Button>
          <Button variant="ghost" size="sm" className="text-destructive" disabled={busy} onClick={() => void onAction(() => deactivateAdminCategory(category.id))}>Deactivate</Button>
        </div>
      </div>)}
    </div>
    <Modal isOpen={Boolean(selected)} onClose={() => { if (!busy) setSelected(null); }}
      title={`${selected?.edit ? 'Change' : 'Preview'} category cover`}
      description={selected?.category.name} maxWidth="xl" isLoading={busy}
      cancelLabel={selected?.edit ? 'Cancel' : 'Close'}
      confirmLabel={selected?.edit ? 'Save cover' : undefined}
      isConfirmDisabled={!replacement}
      onConfirm={selected?.edit ? () => onAction(async () => {
        if (!replacement || !selected) return;
        setCoverError('');
        try {
          const coverImage = await uploadAdminCategoryCover(replacement);
          await updateAdminCategoryCover(selected.category.id, coverImage);
          setSelected(null); setReplacement(null);
        } catch (error) {
          setCoverError(error instanceof Error ? error.message : 'Could not save this cover. Please try again.');
          throw error;
        }
      }) : undefined}>
      {selected && <>
        {selected.edit && <CoverInput id="replacement-category-cover" file={replacement} onChange={setReplacement} disabled={busy} />}
        {coverError && <p role="alert" className="text-sm text-destructive">{coverError}</p>}
        <CoverPreview category={selected.category} url={replacementPreview || categorySpotlightCover(selected.category)} />
        <p className="ep-category-preview-note">Homepage preview. The category appears here only when selected by the trending ranking.</p>
      </>}
    </Modal>
  </section>;
}
