import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { registerServiceWorker } from "./lib/pwa";
import { consumeRecoveryFromUrl } from "./lib/supabase";

// Pull Supabase recovery tokens out of the URL before the hash router
// rewrites window.location.hash. The helper also scrubs the tokens from
// the address bar so they are not left visible to the user.
consumeRecoveryFromUrl();

if (!window.location.hash) {
  window.location.hash = "#/";
}

createRoot(document.getElementById("root")!).render(<App />);
registerServiceWorker();
