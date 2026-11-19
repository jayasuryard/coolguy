import type { Settings } from '../platform/settings';

/** Settings that act on the HTML layer (captions, contrast, motion). */
export function applySettingsToDocument(s: Settings): void {
  document.documentElement.style.setProperty('--caption-scale', String(s.captionScale));
  document.body.classList.toggle('high-contrast', s.highContrast);
  document.body.classList.toggle('reduced-motion', s.reducedMotion);
  const captions = document.getElementById('captions');
  if (captions) captions.hidden = !s.captions;
}
