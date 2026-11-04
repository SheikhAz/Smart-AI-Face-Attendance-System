export class ApiError extends Error {
  constructor(message, { status = 0, code = "", data = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export const DEMO_USERS = [
  { unique_id: "STF001", name: "Aisha Khan", embeddings: [1, 2, 3, 4] },
  { unique_id: "STF002", name: "Rahul Verma", embeddings: [] },
  { unique_id: "STF003", name: "Maria Lopez", embeddings: [1, 2] },
];

let demoCount = 0;

async function demoApi(path) {
  await new Promise(r => setTimeout(r, 500));
  if (path.includes("start-enroll")) { demoCount = 0; return { status: "started", job_id: "demo" }; }
  if (path.includes("enroll-status")) {
    demoCount = Math.min(demoCount + 1, 10);
    return { status: demoCount >= 10 ? "success" : "running", progress: demoCount, target: 10, message: "", lines: [] };
  }
  if (path.includes("enroll-cancel")) return { status: "cancelled" };
  if (path.includes("staff-me")) return { status: "success", company: "Demo Company" };
  if (path.includes("get-users")) return DEMO_USERS;
  if (path.includes("enroll-frame")) return { status: "success" };
  if (path.includes("recognize-frame")) {
    const u = DEMO_USERS[Math.floor(Math.random() * 3)];
    return Math.random() > 0.6
      ? { status: "success", unique_id: u.unique_id, name: u.name }
      : { status: "none" };
  }
  return {};
}
export async function api(cfg, path, body) {
  if (cfg.demo) return demoApi(path);

  const isPost = body !== undefined;
  const headers = { Accept: "application/json" };
  if (isPost) headers["Content-Type"] = "application/json";
  if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;

  let url = (cfg.link || "").replace(/\/$/, "") + path;
  let payload;
  if (isPost) {
    payload = JSON.stringify(cfg.company_id ? { ...body, company_id: cfg.company_id } : body);
  } else if (cfg.company_id) {
    url += (path.includes("?") ? "&" : "?") + "company_id=" + encodeURIComponent(cfg.company_id);
  }

  let res;
  try {
    res = await fetch(url, { method: isPost ? "POST" : "GET", headers, body: payload });
  } catch {
    throw new ApiError("Cannot reach the server. Check the company link and your connection.", { code: "network" });
  }

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError("The server sent an invalid response.", { status: res.status, code: "invalid_json" });
    }
  }

  if (!res.ok) {
    const err = new ApiError((data && data.message) || `Request failed (${res.status}).`, {
      status: res.status,
      code: (data && data.code) || "",
      data,
    });
    if (res.status === 401 && cfg.token && typeof cfg.onAuthError === "function") cfg.onAuthError(err);
    throw err;
  }
  return data;
}