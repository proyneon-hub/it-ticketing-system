import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// This is the frontend entry point. Vite loads it from index.html,
// then React renders the application into the #root element.
createRoot(document.getElementById('root')).render(
  // StrictMode helps catch unsafe React patterns during development.
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
