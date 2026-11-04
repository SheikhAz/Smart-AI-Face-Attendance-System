import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "./api";
import LoginScene from "./LoginScene";
import Home from "./Home";
import EnrollView from "./EnrollView";
const TARGET = 10;

/* ───────── HELPERS ───────── */
function grab(v) {
  if (!v || !v.videoWidth) return null;
  const c = document.createElement("canvas");
  c.width = v.videoWidth;
  c.height = v.videoHeight;
  c.getContext("2d").drawImage(v, 0, 0);
  return c.toDataURL("image/jpeg", 0.85);
}

const initials = (name = "") =>
  name
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "–";

const Arrow = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

const Wordmark = () => (
  <div className="wordmark">
    <img className="wordmark-logo" src="/White_Logo.svg" alt="Smart Attendance Logo" />
    <span>Smart Attendance</span>
  </div>
);

/* ───────── CAMERA ───────── */
function Camera({ active, demo, label, vref, children }) {
  useEffect(() => {
    let stream;
    if (active && !demo && navigator.mediaDevices) {
      navigator.mediaDevices
        .getUserMedia({ video: { width: 640, height: 480 } })
        .then((s) => {
          stream = s;
          if (vref.current) vref.current.srcObject = s;
        })
        .catch(() => {});
    }
    return () => stream && stream.getTracks().forEach((t) => t.stop());
  }, [active, demo]);

  return (
    <div className="cam">
      {demo ? (
        <div className="cam-demo" />
      ) : (
        <video ref={vref} autoPlay playsInline muted />
      )}
      {!active && <div className="cam-off">Camera idle</div>}
      <span className="mark tl" />
      <span className="mark tr" />
      <span className="mark bl" />
      <span className="mark br" />
      {active && <div className="cam-line" />}
      <div className="cam-guide" />
      <div className={"cam-status" + (active ? " live" : "")}>
        <i />
        {label}
      </div>
      {children}
    </div>
  );
}

/* ───────── LOGIN ───────── */
function Login({ onLogin, notice }) {
  const [f, setF] = useState({ link: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // The panel starts hidden behind the GET START button. A pending notice
  // (e.g. "session expired") opens it straight away so it is never missed.
  const [open, setOpen] = useState(Boolean(notice));
  const startRef = useRef(null);
  const linkRef = useRef(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  function openPanel() {
    setOpen(true);
    // On touch devices skip auto-focus so the keyboard doesn't jump in mid-animation.
    if (!window.matchMedia("(pointer: coarse)").matches)
      requestAnimationFrame(() => linkRef.current?.focus({ preventScroll: true }));
  }

  function closePanel() {
    setOpen(false);
    requestAnimationFrame(() => startRef.current?.focus({ preventScroll: true }));
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && closePanel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    let link = f.link.trim();
    if (!/^https?:\/\//.test(link)) {
      const local = /^(localhost|127\.0\.0\.1|192\.168\.|10\.)/.test(link);
      link = (local ? "http://" : "https://") + link;
    }
    try {
      const d = await api({ link }, "/api/staff-login/", {
        email: f.email,
        password: f.password,
        link,
      });
      if (d.status !== "success" || !d.token || !d.company_id)
        throw new Error(d.message || "Login failed.");
      onLogin({
        link,
        token: d.token,
        company_id: d.company_id,
        company: d.company,
      });
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  }

  return (
    <div className={"auth auth--scene" + (open ? " is-open" : "")}>
      <LoginScene />
      <aside className="auth-art">
        <Wordmark />
        <div>
          <h1 className="display">
            Attendance that <em>recognises</em> your team.
          </h1>
          <p className="lede">
            Staff walk in, the camera does the rest. No cards, no sign-in
            sheets, no queues.
          </p>
        </div>
        <small>© {new Date().getFullYear()} Smart Attendance</small>
      </aside>

      <div className="start-dock">
        <button
          type="button"
          ref={startRef}
          className="start-btn"
          onClick={openPanel}
          aria-expanded={open}
          aria-controls="login-panel"
        >
          GET START
        </button>
      </div>

      <main className="auth-form">
        <form id="login-panel" onSubmit={submit}>
          <div className="panel-head">
            <div>
              <p className="eyebrow">Sign in</p>
              <h2 className="title">Welcome back</h2>
            </div>
            <p className="muted">
              Use the credentials for your company workspace.
            </p>
          </div>

          <div className="field">
            <label htmlFor="link">Company link</label>
            <input
              id="link"
              ref={linkRef}
              placeholder="your-company.entergym.in"
              value={f.link}
              onChange={set("link")}
              autoComplete="url"
              required
            />
          </div>

          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              placeholder="you@company.com"
              value={f.email}
              onChange={set("email")}
              autoComplete="email"
              required
            />
          </div>

          <div className="field">
            <label htmlFor="pw">Password</label>
            <input
              id="pw"
              type="password"
              placeholder="••••••••"
              value={f.password}
              onChange={set("password")}
              autoComplete="current-password"
              required
            />
          </div>

          {(err || notice) && <div className="notice" role="alert">{err || notice}</div>}

          <div className="panel-actions">
            <button className="btn primary" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
            <button
              type="button"
              className="text-link"
              onClick={() => onLogin({ demo: true, company: "Demo Company" })}
            >
              Explore in demo mode
            </button>
          </div>

          <button
            type="button"
            className="panel-close"
            onClick={closePanel}
            aria-label="Close sign in"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </form>
      </main>
    </div>
  );
}

function Enroll({ cfg, back }) {
  const [users, setUsers] = useState(null);
  const [uid, setUid] = useState("");
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [progress, setProgress] = useState(0);
  const [hint, setHint] = useState("");
  const [msg, setMsg] = useState("");
  const vref = useRef(null);

  const loadUsers = () =>
    api(cfg, "/api/get-users/")
      .then(d => setUsers(Array.isArray(d) ? d : []))
      .catch(e => { setUsers([]); setMsg(e.message); });
  useEffect(() => { loadUsers(); }, []);

  useEffect(() => {
    if (!running) return;
    let stop = false, busy = false, first = true, n = 0;
    const began = Date.now();
    const id = setInterval(async () => {
      if (busy || stop) return;
      const timeUp = Date.now() - began > 30000;
      const img = cfg.demo ? "demo" : grab(vref.current);
      if (!img && !timeUp) return;           // video not ready yet
      busy = true;
      try {
        const body = timeUp
          ? { unique_id: uid, finalize: true }
          : { unique_id: uid, image: img, reset: first };
        first = false;
        const d = await api(cfg, "/api/enroll-frame/", body);
        if (stop) return;
        n = d.progress ?? n + 1;             // demo mode returns no progress
        setProgress(n);
        setHint(REASONS[d.reason] || "");
        if (d.done || n >= TARGET) {
          setDone(true); setRunning(false); loadUsers();
        }
      } catch (e) {
        if (!stop) { setMsg(e.message); setRunning(false); }
      }
      busy = false;
    }, 1500);
    return () => { stop = true; clearInterval(id); };
  }, [running]);

  function start() {
    setMsg(""); setHint(""); setProgress(0); setDone(false);
    setRunning(true);
  }

  const label = running ? "Recording" : done ? "Complete" : "Standby";
  const help = running
    ? hint || "Look at the camera. Turn your head slowly and try a few expressions."
    : done ? "Enrollment complete." : "Choose a staff member, then start.";

  return (
    <EnrollView
      back={back}
      cam={<Camera active={running} demo={cfg.demo} vref={vref} label={label} />}
      users={users} uid={uid} setUid={setUid}
      running={running} done={done} progress={progress} target={TARGET}
      label={label} help={help} msg={msg}
      onStart={start} onCancel={() => setRunning(false)}
    />
  );
}

/* ───────── ATTENDANCE ───────── */
function Attend({ cfg, back }) {
  const [on, setOn] = useState(false);
  const [log, setLog] = useState([]);
  const [last, setLast] = useState(null);
  const vref = useRef(null);
  const seen = useRef({});

  useEffect(() => {
    if (!on) return;
    let stop = false,
      busy = false;
    const id = setInterval(async () => {
      if (busy || stop) return;
      const img = cfg.demo ? "demo" : grab(vref.current);
      if (!img) return;
      busy = true;
      try {
        const d = await api(cfg, "/api/recognize-frame/", { image: img });
        if (
          d.status === "success" &&
          (!seen.current[d.unique_id] ||
            Date.now() - seen.current[d.unique_id] > 60000)
        ) {
          seen.current[d.unique_id] = Date.now();
          const t = new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          });
          setLast(d);
          setLog((l) => [{ ...d, t }, ...l].slice(0, 30));
        }
      } catch {}
      busy = false;
    }, 900);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [on]);

  return (
    <div className="page">
      <button className="btn quiet back" onClick={back}>
        ← Back
      </button>
      <p className="eyebrow">Live</p>
      <h1 className="display sm">
        Today's <em>attendance</em>
      </h1>

      <div className="stage">
        <Camera
          active={on}
          demo={cfg.demo}
          vref={vref}
          label={on ? "Scanning" : "Offline"}
        >
          {last && on && <div className="cam-chip">{last.name}</div>}
        </Camera>

        <aside className="panel">
          <div className="meter">
            <span className="figure">{log.length}</span>
            <span className="of">present today</span>
          </div>

          <button
            className={"btn full " + (on ? "outline" : "primary")}
            onClick={() => setOn(!on)}
          >
            {on ? "Stop scanner" : "Start scanner"}
          </button>

          <div className="log">
            {log.length === 0 && (
              <div className="empty">No one has been marked yet.</div>
            )}
            {log.map((r, i) => (
              <div className="row" key={i}>
                <span className="avatar">{initials(r.name)}</span>
                <span className="who">
                  <b>{r.name}</b>
                  <small>{r.unique_id}</small>
                </span>
                <time>{r.t}</time>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ───────── APP ───────── */
const KEY = "attendance.session";
function App() {
  const [cfg, setCfg] = useState(null);
  const [view, setView] = useState("home");
  const [booting, setBooting] = useState(true);
  const [notice, setNotice] = useState("");
  const logout = useCallback((m = "") => {
    sessionStorage.removeItem(KEY);
    setCfg(null);
    setView("home");
    setNotice(m);
  }, []);
  const withAuth = (s) => ({
    ...s,
    onAuthError: () => logout("Your session expired. Please sign in again."),
  });

  useEffect(() => {
    let s = null;
    try {
      s = JSON.parse(sessionStorage.getItem(KEY) || "null");
    } catch {}
    if (!s?.token || !s?.link || !s?.company_id) {
      setBooting(false);
      return;
    }
    const c = withAuth(s);
    api(c, "/api/staff-me/")
      .then((d) => setCfg({ ...c, company: d.company || c.company }))
      .catch(() => sessionStorage.removeItem(KEY))
      .finally(() => setBooting(false));
  }, []);

  const onLogin = (c) => {
    if (!c.demo)
      sessionStorage.setItem(
        KEY,
        JSON.stringify({
          link: c.link,
          token: c.token,
          company_id: c.company_id,
          company: c.company,
        }),
      );
    setNotice("");
    setCfg(c.demo ? c : withAuth(c));
    setView("home");
  };
  if (booting) return null;
  if (!cfg) return <Login onLogin={onLogin} notice={notice} />;
  if (view === "enroll")
    return <Enroll cfg={cfg} back={() => setView("home")} />;
  if (view === "attend")
    return <Attend cfg={cfg} back={() => setView("home")} />;
  return <Home cfg={cfg} go={setView} logout={() => logout()} />;
}

export default App;