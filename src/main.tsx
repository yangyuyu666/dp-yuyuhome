import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import RoulettePage from './RoulettePage.tsx';
import ToolsPage from './ToolsPage.tsx';
import './index.css';

const { pathname, hostname } = window.location;
const isToolsHost = hostname === 'tools.dploveyuyu.site';
const Page = pathname === '/roulette'
  ? RoulettePage
  : isToolsHost || pathname === '/tools'
    ? ToolsPage
    : App;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
