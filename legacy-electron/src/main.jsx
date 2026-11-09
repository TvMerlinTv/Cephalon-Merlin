import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import Overlay from './pages/Overlay.jsx';
import { GameDataProvider } from './lib/GameData.jsx';
import './styles.css';

// "#overlay" = durchsichtiges Ingame-Overlay (eigenes Fenster), sonst die normale App.
const isOverlay = window.location.hash.startsWith('#overlay');

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <GameDataProvider>{isOverlay ? <Overlay /> : <App />}</GameDataProvider>
  </StrictMode>,
);
