import EnrollScene from "./EnrollScene";
import "./AttendView.css";

/* Attendance page, same look as the enrollment page:
   dotted face scene, grid lines, nav, big headline, glass panel with the camera.
   It reuses the .enroll / .en-* styles from the enrollment stylesheet and only
   adds the "marked today" list (see AttendView.css). */

const initials = (name = "") =>
  name
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "–";

const pad = (n) => String(n).padStart(2, "0");

export default function AttendView({ back, cam, on, onToggle, log }) {
  const last = log[0];

  return (
    <div className="enroll attend">
      {/* the head wakes up (faster red sweep + scan line) while the scanner is on */}
      <EnrollScene active={on} />
      <div className="en-grid" aria-hidden="true" />

      <div className="en-stage">
        <nav className="en-nav">
          <button type="button" className="en-link" onClick={back}>← BACK</button>
          <span className="en-link dim">ATTENDANCE</span>
          <span className="en-link dim">{on ? "SCANNING" : "OFFLINE"}</span>
          <button type="button" className="en-cta" onClick={onToggle}>
            {on ? "STOP SCANNER" : "START SCANNER"}
            <i />
          </button>
        </nav>

        <h1 className="en-title">
          Today's
          <br />
          attendance
        </h1>

        <p className="en-foot">
          {on
            ? "Look at the camera. Everyone in view is marked automatically."
            : "Start the scanner to begin marking attendance."}
        </p>

        <section className="at-log" aria-label="Marked present today" aria-live="polite">
          <h2>
            Marked today <span>{pad(log.length)}</span>
          </h2>
          {log.length === 0 ? (
            <p className="at-empty">No one has been marked yet.</p>
          ) : (
            <ul className="at-rows">
              {log.map((r, i) => (
                <li className="at-row" key={`${r.unique_id}-${r.t}-${i}`}>
                  <span className="at-av">{initials(r.name)}</span>
                  <span className="at-who">
                    <b>{r.name}</b>
                    <small>{r.unique_id}</small>
                  </span>
                  <time>{r.t}</time>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="en-panel">
          {cam}
          <div className="at-label">Last marked</div>
          <div className="at-last">
            {last ? (
              <>
                <span className="at-av">{initials(last.name)}</span>
                <b>{last.name}</b>
                <time>{last.t}</time>
              </>
            ) : (
              <span className="at-none">Waiting for a face…</span>
            )}
          </div>
          <div className="en-meter">
            <b>{pad(log.length)}</b>
            <span>present today</span>
          </div>
        </aside>

        <p className="en-tag">
          Walk in.
          <br />
          Marked present.
        </p>
      </div>
    </div>
  );
}