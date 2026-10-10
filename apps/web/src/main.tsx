import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { DemoApp } from './demo/DemoApp';
import './styles.css';

const container = document.getElementById('root');
if (container === null) throw new Error('Missing #root element');

// `__STATIC_DEMO__` is replaced at build time; in the normal build the demo is unreachable code
// and is left out of the bundle.
createRoot(container).render(<StrictMode>{__STATIC_DEMO__ ? <DemoApp /> : <App />}</StrictMode>);
