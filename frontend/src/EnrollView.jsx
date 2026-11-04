import EnrollScene from "./EnrollScene";
import "./EnrollScene.css";

export default function EnrollView({
  back, cam, users, uid, setUid, running, done, progress, target,
  label, help, msg, onStart, onCancel,
}) {
  const user = (users || []).find((u) => u.unique_id === uid);
  const faces = user ? user.embedding_count ?? (user.embeddings || []).length : "–";

  return (
    <div className="enroll">
      <EnrollScene active={running} />
      <div className="en-grid" aria-hidden="true" />

      <div className="en-stage">
        <header className="en-nav">
          <button className="en-link" onClick={back}>← BACK</button>
          <span className="en-link dim">ENROLLMENT</span>
          <span className="en-link dim">{label.toUpperCase()}</span>
          {running ? (
            <button className="en-cta" onClick={onCancel}>CANCEL <i /></button>
          ) : (
            <button className="en-cta" disabled={!uid} onClick={onStart}>
              {done ? "ENROLL ANOTHER" : "START CAPTURE"} <i />
            </button>
          )}
        </header>

        <h1 className="en-title">Add a<br />staff face</h1>

        <aside className="en-panel">
          {cam}
          <label htmlFor="staff">Staff member</label>
          <select id="staff" value={uid} onChange={(e) => setUid(e.target.value)} disabled={running}>
            <option value="">{users === null ? "Loading…" : "Choose a member"}</option>
            {(users || []).map((u) => (
              <option key={u.unique_id} value={u.unique_id}>
                {u.unique_id} — {u.name || "N/A"} ({u.embedding_count ?? (u.embeddings || []).length} faces)
              </option>
            ))}
          </select>
          <div className="en-meter">
            <b>{String(progress).padStart(2, "0")}</b>
            <span>of {target} captures</span>
          </div>
          <div className="ticks" aria-hidden="true">
            {Array.from({ length: target }).map((_, i) => (
              <i key={i} className={i < progress ? "on" : ""} />
            ))}
          </div>
          {msg && <div className="notice" role="alert">{msg}</div>}
        </aside>

        <div className="en-stat"><b>{faces}</b>faces on file</div>
        <p className="en-foot">{help}</p>
        <h2 className="en-tag">Learned once.<br />Recognised always.</h2>
      </div>
    </div>
  );
}