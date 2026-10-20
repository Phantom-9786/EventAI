'use client';
import { lockPageScroll } from '@/lib/scroll-lock';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, X } from 'lucide-react';
const ClientMap = dynamic(
  () => import('./venue-map-client').then((module) => module.VenueMapClient),
  {
    ssr: false,
    loading: () => (
      <div className="ep-map-loading" role="status" style={{ height: 150 }}>
        Loading venue map…
      </div>
    ),
  },
);
export function VenueMap(props: { lat: number; lng: number; name: string }) {
  const [expanded, setExpanded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!expanded) return;
    const node = dialog.current;
    const triggerButton = trigger.current;
    node?.showModal();
    const unlockScroll = lockPageScroll();
    return () => {
      node?.close();
      triggerButton?.focus();
      unlockScroll();
    };
  }, [expanded]);
  return (
    <>
      <div className="ep-map-preview">
        <ClientMap {...props} />
        <button
          type="button"
          ref={trigger}
          className="ep-map-expand"
          aria-label="Enlarge venue map"
          title="Enlarge map"
          onClick={() => setExpanded(true)}
        >
          <Maximize2 size={17} />
        </button>
      </div>
      {expanded &&
        createPortal(
          <dialog
            className="ep-map-dialog"
            ref={dialog}
            aria-label={'Map of ' + props.name}
            onCancel={() => setExpanded(false)}
            onClose={() => setExpanded(false)}
            onClick={(event) => {
              if (event.target === event.currentTarget) setExpanded(false);
            }}
          >
            <header>
              <h2>{props.name}</h2>
              <button
                type="button"
                autoFocus
                aria-label="Close enlarged map"
                onClick={() => setExpanded(false)}
              >
                <X size={20} />
              </button>
            </header>
            <div className="ep-map-expanded-content">
              <ClientMap {...props} />
            </div>
          </dialog>,
          document.body,
        )}
    </>
  );
}
