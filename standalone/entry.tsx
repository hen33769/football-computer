import "antd/dist/reset.css";
import "../app/globals.css";

import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import FootballApp, { type AppView } from "../app/FootballApp";

function StandaloneApp() {
  const initialView = window.location.hash === "#settings" ? "settings" : window.location.hash === "#orders" ? "orders" : "betting";
  const [view, setViewState] = useState<AppView>(initialView);
  const setView = (nextView: AppView) => {
    window.location.hash = nextView === "betting" ? "" : nextView;
    setViewState(nextView);
  };
  return <FootballApp key={view} initialView={view} onNavigate={setView} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StandaloneApp />
  </StrictMode>,
);
