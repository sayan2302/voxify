import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Intercept remote Hugging Face voice fetch calls to serve locally from /voices/ with 0ms latency
if (typeof window !== 'undefined' && window.fetch && !(window as any).__vocalis_fetch_intercepted) {
  (window as any).__vocalis_fetch_intercepted = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request)?.url;
    if (url && typeof url === 'string' && url.includes('Kokoro-82M-v1.0-ONNX/resolve/main/voices/')) {
      const voiceFile = url.split('/').pop();
      if (voiceFile && voiceFile.endsWith('.bin')) {
        return originalFetch(`/voices/${voiceFile}`, init);
      }
    }
    return originalFetch(input, init);
  };
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
