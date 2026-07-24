import { CheckCircle2, FileSearch } from "lucide-react";
import { Link } from "react-router-dom";
import { FindingsPanel } from "../components/FindingsPanel.tsx";
import { useScan } from "../state/scan-store.tsx";

export function FindingsPage() {
  const { findings, results, running, completedAt } = useScan();
  const hasScanResults = results.length > 0;

  return (
    <div>
      <div className="section-heading">
        <div>
          <p className="eyebrow-plain">Remediation</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">Findings</h1>
          <p className="mt-2 text-sm text-slate-500">
            {findings.length} finding{findings.length === 1 ? "" : "s"}
            {running ? " · scan in progress" : ""}
            {!running && hasScanResults ? ` · ${results.length} repositories scanned` : ""}
            {!running && completedAt ? ` · last scan ${new Date(completedAt).toLocaleString()}` : ""}
          </p>
        </div>
        <Link to="/scans" className="secondary-button">View scan activity</Link>
      </div>

      <section className="panel mt-7">
        {findings.length > 0 || running ? (
          <FindingsPanel />
        ) : hasScanResults ? (
          <div className="empty-state min-h-[50vh]">
            <span className="empty-icon"><CheckCircle2 size={24} /></span>
            <h2>No malware found</h2>
            <p>
              {results.length} repositor{results.length === 1 ? "y was" : "ies were"} scanned in this session and none matched the current malware signature or batch-file rule.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Link className="primary-button" to="/scans">View scan activity</Link>
              <Link className="secondary-button" to="/projects">Scan more repositories</Link>
            </div>
            <div className="mt-8 w-full max-w-2xl space-y-2 text-left">
              {results.slice().reverse().map((result) => (
                <div key={`${result.repository}:${result.branch}`} className="finding-item">
                  <span className="finding-icon-warn"><CheckCircle2 size={16} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-200">{result.repository}</p>
                    <p className="mt-1 text-xs text-slate-600">
                      {result.branch} · {result.scanned} files scanned · {result.findings.length} findings
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="empty-state min-h-[50vh]">
            <span className="empty-icon"><FileSearch size={24} /></span>
            <h2>No findings to review</h2>
            <p>Run a scan first. Findings stay available in this browser tab until you start a new scan or close the tab.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Link className="primary-button" to="/projects">Choose repositories</Link>
              <Link className="secondary-button" to="/scans">Start a scan</Link>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
