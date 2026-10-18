import { createRoot } from 'react-dom/client';
import { Root } from './app/App';
import './styles.css';

declare const process: { env: { NODE_ENV: string } };

createRoot(document.getElementById('root')!).render(<Root />);

// Offline support: cache the app shell so it opens without a connection.
if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      // Check for a new version whenever the app comes back to the foreground.
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch((e) => console.warn('Service worker registration failed', e));
  });
}
