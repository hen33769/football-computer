import "antd/dist/reset.css";
import "../app/globals.css";

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { getTeamNameGroups } from "../app/api-client/team-aliases";
import FootballApp, { type AppView } from "../app/FootballApp";
import type { TeamNameGroup } from "../app/team-aliases";

const CLOUD_API_BASE = "https://smgr.online";

function StandaloneApp() {
  const initialView = window.location.hash === "#settings" ? "settings" : window.location.hash === "#orders" ? "orders" : "betting";
  const [view, setViewState] = useState<AppView>(initialView);
  const [teamNameGroups, setTeamNameGroups] = useState<TeamNameGroup[]>([]);
  useEffect(() => {
    let active = true;
    void getTeamNameGroups(CLOUD_API_BASE)
      .then((response) => { if (active) setTeamNameGroups(response.groups); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);
  const setView = (nextView: AppView) => {
    window.location.hash = nextView === "betting" ? "" : nextView;
    setViewState(nextView);
  };
  return <FootballApp key={view} initialView={view} onNavigate={setView} teamNameGroups={teamNameGroups} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StandaloneApp />
  </StrictMode>,
);
