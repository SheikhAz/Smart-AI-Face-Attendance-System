"""
Starts source/enroll_runner.py (-> add_face.py) on the machine running Django.
The camera window opens on THAT machine, so this is for a local/kiosk setup.
"""
import json
import os
import re
import subprocess
import sys
import threading
import uuid
from collections import deque
from pathlib import Path

from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from .auth import _err, company_auth

UID_RE = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")
PROGRESS_RE = re.compile(r"Captured embedding (\d+)/(\d+)")
TIMEOUT_SECONDS = 180
KEEP_JOBS = 20

_jobs = {}
_lock = threading.Lock()


def _kill(proc):
    """Kill the process and everything it started (venv launcher on Windows, children on POSIX)."""
    if proc.poll() is not None:
        return
    try:
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
        else:
            os.killpg(proc.pid, 9)
    except OSError:
        pass
    try:
        proc.kill()
    except OSError:
        pass


def _source_dir():
    return Path(getattr(settings, "ENROLL_SOURCE_DIR", Path(settings.BASE_DIR).parent / "source"))


def _callback_url():
    # Fixed in settings on purpose: the child sends INTERNAL_API_KEY there, so it must
    # never be derived from the request's Host header.
    return getattr(settings, "ENROLL_CALLBACK_URL", "http://127.0.0.1:8000").rstrip("/")


def _failure_message(lines, code, timed_out):
    text = "\n".join(lines)
    if timed_out:
        return "Enrollment timed out."
    if "Duplicate face detected" in text:
        return "This face already matches another staff member."
    if "staff member not found" in text:
        return "Staff member not found in this company."
    for line in reversed(lines):
        if "❌" in line or "⚠" in line or line.startswith("ERROR"):
            return re.sub(r"^[^\w]+", "", line)
    return f"Enrollment did not finish (exit code {code})."


def _watch(job):
    proc = job["proc"]
    for line in proc.stdout:
        line = line.strip()
        if not line:
            continue
        with _lock:
            job["lines"].append(line)
            m = PROGRESS_RE.search(line)
            if m:
                job["progress"], job["target"] = int(m.group(1)), int(m.group(2))
    code = proc.wait()
    with _lock:
        if job["cancelled"]:
            job["status"], job["message"] = "cancelled", "Enrollment was cancelled."
        elif any("Enrollment complete" in l for l in job["lines"]):
            job["status"], job["message"] = "success", "Enrollment complete."
        else:
            job["status"] = "failed"
            job["message"] = _failure_message(list(job["lines"]), code, job["timed_out"])


def _timeout(job):
    with _lock:
        if job["status"] != "running":
            return
        job["timed_out"] = True
    _kill(job["proc"])


def _prune():
    finished = [k for k, j in _jobs.items() if j["status"] != "running"]
    for k in finished[:-KEEP_JOBS]:
        _jobs.pop(k, None)


@csrf_exempt
@require_POST
@company_auth
def start_enroll(request):
    try:
        uid = str(json.loads(request.body or "{}").get("unique_id", "")).strip()
    except (ValueError, AttributeError):
        uid = ""
    if not UID_RE.match(uid):
        return _err("A valid unique_id is required.", 400, "bad_unique_id")

    src = _source_dir()
    runner = src / "enroll_runner.py"
    if not runner.is_file():
        return _err("Enrollment script not found on the server.", 500, "script_missing")

    env = os.environ.copy()
    env.update({
        "INTERNAL_API_KEY": settings.INTERNAL_API_KEY,
        "COMPANY_ID": request.company_id,
        "ATTENDANCE_BASE_URL": _callback_url(),
        "PYTHONUTF8": "1",
        "PYTHONIOENCODING": "utf-8",
    })

    with _lock:
        if any(j["status"] == "running" for j in _jobs.values()):
            return _err("Another enrollment is already running.", 409, "busy")
        try:
            proc = subprocess.Popen(
                [sys.executable, "-u", str(runner), uid],   # list args: no shell
                cwd=str(src), env=env, stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", errors="replace",
                start_new_session=(os.name != "nt"),
            )
        except OSError as exc:
            return _err(f"Could not start the enrollment script: {exc}", 500, "spawn_failed")
        job_id = uuid.uuid4().hex
        job = {
            "proc": proc, "company_id": request.company_id, "unique_id": uid,
            "status": "running", "message": "", "progress": 0, "target": 10,
            "lines": deque(maxlen=200), "cancelled": False, "timed_out": False,
        }
        _jobs[job_id] = job
        _prune()

    threading.Thread(target=_watch, args=(job,), daemon=True).start()
    timer = threading.Timer(TIMEOUT_SECONDS, _timeout, args=(job,))
    timer.daemon = True
    timer.start()
    return JsonResponse({"status": "started", "job_id": job_id})


def _own_job(request, job_id):
    job = _jobs.get(job_id or "")
    if job is None or job["company_id"] != request.company_id:
        return None  # same answer for "missing" and "someone else's"
    return job


@require_GET
@company_auth
def enroll_status(request):
    job = _own_job(request, request.GET.get("job_id"))
    if job is None:
        return _err("Unknown job.", 404, "job_not_found")
    with _lock:
        return JsonResponse({
            "status": job["status"], "progress": job["progress"], "target": job["target"],
            "message": job["message"], "lines": list(job["lines"])[-8:],
        })


@csrf_exempt
@require_POST
@company_auth
def enroll_cancel(request):
    try:
        job_id = json.loads(request.body or "{}").get("job_id")
    except (ValueError, AttributeError):
        job_id = None
    job = _own_job(request, job_id)
    if job is None:
        return _err("Unknown job.", 404, "job_not_found")
    with _lock:
        running = job["status"] == "running"
        if running:
            job["cancelled"] = True
    if running:
        _kill(job["proc"])
    return JsonResponse({"status": "cancelling" if running else job["status"]})