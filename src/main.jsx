import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Disable text selection drag across the entire window
document.addEventListener('selectstart', (e) => {
  e.preventDefault();
  return false;
});

// Disable dragging of any elements or text
document.addEventListener('dragstart', (e) => {
  e.preventDefault();
  return false;
});

// Disable right-click context menu
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  return false;
});

// Block clipboard events (copy, cut, paste)
document.addEventListener('copy', (e) => {
  e.preventDefault();
  return false;
});
document.addEventListener('cut', (e) => {
  e.preventDefault();
  return false;
});
document.addEventListener('paste', (e) => {
  e.preventDefault();
  return false;
});

// Immediately clear any accidental selection ranges
document.addEventListener('selectionchange', () => {
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed) {
    selection.removeAllRanges();
  }
});

// Intercept Ctrl+C, Ctrl+V, Cmd+C, Cmd+V, Ctrl+X, Cmd+X, Ctrl+A, etc.
window.addEventListener('keydown', (e) => {
  const isMod = e.ctrlKey || e.metaKey;
  if (isMod) {
    const key = e.key.toLowerCase();
    if (['c', 'v', 'x', 'a', 'p', 's', 'u'].includes(key)) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
  }
}, true);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
