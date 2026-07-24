import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "../layouts/AppLayout.tsx";
import { DashboardPage } from "../pages/DashboardPage.tsx";
import { FindingsPage } from "../pages/FindingsPage.tsx";
import { ProjectsPage } from "../pages/ProjectsPage.tsx";
import { ReportsPage } from "../pages/ReportsPage.tsx";
import { ScansPage } from "../pages/ScansPage.tsx";
import { SettingsPage } from "../pages/SettingsPage.tsx";
import { TeamPage } from "../pages/TeamPage.tsx";

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="scans" element={<ScansPage />} />
        <Route path="findings" element={<FindingsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
