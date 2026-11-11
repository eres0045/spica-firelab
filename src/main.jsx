import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// No StrictMode: the Three.js scenes manage their own mount/unmount and
// double-invoked effects in dev would double-create WebGL contexts.
createRoot(document.getElementById('root')).render(<App />);
