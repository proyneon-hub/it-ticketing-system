import React from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router-dom';
import App from './App';
import { routes } from './routes';
import './styles.css';

// This is the frontend entry point. Vite loads it from index.html,
// then React renders the application into the #root element.
const router = createBrowserRouter(routes);

createRoot(document.getElementById('root') as HTMLElement).render(
  // StrictMode helps catch unsafe React patterns during development.
  <React.StrictMode>
    <App router={router} />
  </React.StrictMode>
);
