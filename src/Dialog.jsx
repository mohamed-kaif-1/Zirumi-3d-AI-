import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';

export default function Dialog({ title, eyebrow, onClose, className = '', children, style }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement;
    const content = document.getElementById('zirumi-content');
    const inert = content?.inert;
    const overflow = document.body.style.overflow;
    if (content) content.inert = true;
    document.body.style.overflow = 'hidden';
    ref.current.querySelector('button')?.focus();
    const keyDown = event => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const items = [...ref.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]')].filter(el => el.getClientRects().length);
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keyDown);
    return () => {
      document.removeEventListener('keydown', keyDown);
      if (content) content.inert = inert;
      document.body.style.overflow = overflow;
      previous?.isConnected && previous.focus();
    };
  }, [onClose]);
  return createPortal(<div className="avatar-modal-overlay" onClick={onClose} style={style}>
    <section ref={ref} className={`avatar-modal ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={event => event.stopPropagation()}>
      <header className="avatar-modal-header"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2 id={titleId}>{title}</h2></div><button className="icon-button avatar-modal-close" type="button" onClick={onClose} aria-label="Close dialog"><Icon name="close" /></button></header>
      {children}
    </section>
  </div>, document.body);
}
