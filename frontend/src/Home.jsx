import HomeScene from "./HomeScene";
import "./Home.css";

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

export default function Home({ cfg, go, logout }) {
  return (
    <div className="home home--scene">
      <HomeScene />

      <header className="home-nav">
        <div className="wordmark">
          <img className="wordmark-logo" src="/White_Logo.svg" alt="Smart Attendance Logo" />
          <span>Smart Attendance</span>
        </div>
        <div className="home-nav-right">
          <span className="chip">{cfg.company}</span>
          <button className="btn quiet" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      <section className="home-hero">
        <p className="eyebrow">Control centre</p>
        <h1 className="display">
          What would you like <em>to do?</em>
        </h1>
      </section>

      <section className="home-actions">
        <button className="home-action" onClick={() => go("enroll")}>
          <span className="home-action-body">
            <strong>Enroll a staff face</strong>
            <span>
              Capture several angles of a team member so recognition stays
              accurate.
            </span>
          </span>
          <span className="home-go">
            <Arrow />
          </span>
        </button>

        <button className="home-action" onClick={() => go("attend")}>
          <span className="home-action-body">
            <strong>Start attendance</strong>
            <span>
              Open the live scanner. Recognised staff are marked present
              automatically.
            </span>
          </span>
          <span className="home-go">
            <Arrow />
          </span>
        </button>
      </section>
    </div>
  );
}