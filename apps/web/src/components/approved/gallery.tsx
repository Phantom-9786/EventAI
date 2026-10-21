'use client';
import { useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';
import { EventImage } from './event-image';
export function PreviewGallery({ images, title }: { images: string[]; title: string }) {
  const [selected, setSelected] = useState('');
  const [zoomed, setZoomed] = useState(false);
  const [failed, setFailed] = useState<string[]>([]);
  const available = Array.from(new Set(images)).filter(
    (src) => src && !failed.includes(src),
  );
  const current = available.includes(selected) ? selected : available[0];
  const index = available.indexOf(current);
  const modal = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const reject = (src: string) =>
    setFailed((old) => (old.includes(src) ? old : [...old, src]));
  const next = (offset: number) => {
    setZoomed(false);
    setSelected(available[(index + offset + available.length) % available.length]);
  };
  return (
    <div className="ep-event-gallery">
      <button
        className="gallery-main"
        ref={trigger}
        type="button"
        aria-label="View event image full size"
        onClick={() => {
          setZoomed(false);
          if (current) modal.current?.showModal();
        }}
      >
        <EventImage
          src={current}
          alt={title}
          loading="eager"
          onImageFailed={() => current && reject(current)}
          className="ep-details-photo"
        />
        {!!available.length && (
          <span>
            View gallery {index + 1} / {available.length}
          </span>
        )}
      </button>
      {available.length > 1 && (
        <div className="thumbnails">
          {available.map((src, i) => (
            <button
              type="button"
              key={src}
              className={current === src ? 'selected' : ''}
              aria-label={'View photo ' + (i + 1)}
              aria-pressed={current === src}
              onClick={() => setSelected(src)}
            >
              <EventImage
                src={src}
                alt={title + ' — photo ' + (i + 1)}
                onImageFailed={() => reject(src)}
              />
            </button>
          ))}
        </div>
      )}
      {process.env.NODE_ENV === 'development' &&
        images.some((src) => src.includes('eventpoint_local_sample=1')) && (
          <p className="ep-gallery-sample-note">
            Local gallery preview · additional photos are illustrative samples.
          </p>
        )}
      <dialog
        className="image-dialog"
        ref={modal}
        onClose={() => { setZoomed(false); trigger.current?.focus({ preventScroll: true }); }}
        aria-label={title + ' image gallery'}
      >
        <button
          className="close"
          type="button"
          aria-label="Close image"
          onClick={() => modal.current?.close()}
        >
          <X size={20} />
        </button>
        <div className={'ep-full-image-scroll' + (zoomed ? ' is-zoomed' : '')}>
          <EventImage src={current} alt={title} />
        </div>
        <button className="btn outline ep-image-zoom" type="button" onClick={() => setZoomed(value => !value)}
          aria-label={zoomed ? 'Fit entire image' : 'Zoom into image'} aria-pressed={zoomed}>
          {zoomed ? <ZoomOut className="icon" /> : <ZoomIn className="icon" />}
          {zoomed ? 'Fit image' : 'Zoom in'}
        </button>
        {available.length > 1 && (
          <div className="ep-gallery-controls">
            <button
              type="button"
              className="btn outline"
              aria-label="Previous photo"
              onClick={() => next(-1)}
            >
              <ChevronLeft className="icon" />
            </button>
            <span>
              {index + 1} / {available.length}
            </span>
            <button
              type="button"
              className="btn outline"
              aria-label="Next photo"
              onClick={() => next(1)}
            >
              <ChevronRight className="icon" />
            </button>
          </div>
        )}
      </dialog>
    </div>
  );
}
