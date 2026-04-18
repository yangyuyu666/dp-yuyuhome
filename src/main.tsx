import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import ToolsPage from './ToolsPage.tsx';
import './index.css';

const pathname = window.location.pathname;
const Page = pathname === '/tools' ? ToolsPage : App;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
