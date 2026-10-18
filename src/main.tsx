import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { init } from './store/store';
import { seedChanges } from './store/actions';
import { requestPersistence } from './db/db';
import { initPWA } from './pwa';
import { startSyncService } from './sync/service';

const root = createRoot(document.getElementById('root')!);

init(() => seedChanges())
  .then(() => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    void requestPersistence();
    initPWA();
    startSyncService();
  })
  .catch((e) => {
    console.error(e);
    root.render(
      <div style={{ padding: 24, fontFamily: 'system-ui', color: '#eee' }}>
        <h1>Impossible d’ouvrir la base de données locale</h1>
        <p>Votre navigateur bloque peut-être le stockage (navigation privée). Détail : {String(e)}</p>
      </div>,
    );
  });
