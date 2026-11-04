# ══════════════════════════════════════════════════════════════════════════════
#  Face Attendance Client — Smart Embedding Sync
#  Drop-in replacement for attendance.py.
#
#  Key improvements over the previous version:
#    • Race-free startup  (version fetched BEFORE users loaded)
#    • Atomic FAISS swap  (old index stays live until new one is complete)
#    • Redundant _last_user_count guard removed  (version check is sufficient)
#    • users_lock / users_map_lock consolidated into the faiss_lock swap
#    • last_version_check_lock removed  (only touched from main thread)
#    • Structured logging via the logging module instead of bare print()
#    • Specific exception types where appropriate
# ══════════════════════════════════════════════════════════════════════════════

import os
os.environ['TF_ENABLE_ONEDNN_OPTS'] = '0'
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'

import absl.logging
absl.logging.set_verbosity(absl.logging.ERROR)
absl.logging.use_absl_handler()

import logging
logging.getLogger('tensorflow').setLevel(logging.ERROR)
logging.getLogger('absl').setLevel(logging.ERROR)

# Module-level logger — use this throughout instead of bare print() for
# anything that isn't a user-facing UI message.
logger = logging.getLogger("face_attendance")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)

import time
import threading

import cv2
import faiss
import numpy as np
import requests
from deepface import DeepFace


# ──────────────────────────────────────────────────────────────────────────────
# SOUND
# ──────────────────────────────────────────────────────────────────────────────

try:
    import pygame
    pygame.mixer.init(frequency=44100, size=-16, channels=2, buffer=512)
    _SOUND_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sound.mp3")
    if os.path.exists(_SOUND_PATH):
        _attendance_sound = pygame.mixer.Sound(_SOUND_PATH)
        logger.info("Sound loaded: %s", _SOUND_PATH)
    else:
        _attendance_sound = None
        logger.warning("Sound file not found: %s", _SOUND_PATH)
    _SOUND_AVAILABLE = True
except Exception as _e:
    _SOUND_AVAILABLE  = False
    _attendance_sound = None
    logger.warning("pygame unavailable — sound disabled: %s", _e)


def _play_sound() -> None:
    """Fire-and-forget attendance chime."""
    if _SOUND_AVAILABLE and _attendance_sound:
        try:
            _attendance_sound.play()
        except Exception as exc:
            logger.warning("Sound playback error: %s", exc)


# ──────────────────────────────────────────────────────────────────────────────
# CONFIG  (edit these values for your deployment)
# ──────────────────────────────────────────────────────────────────────────────

API_URL      = "https://golden-gym.entergym.in/api/mark-attendance/"
USERS_API    = "https://golden-gym.entergym.in/api/get-users/"
VERSION_API  = "https://golden-gym.entergym.in/api/embedding-version/"
API_KEY      = "Bismillahir-Rahmanir-Rahim@786"
GYM_ID       = "e928030c-7725-484b-9925-7fc6851b8929"

# Recognition thresholds
THRESHOLD      = 0.82   # Cosine similarity cutoff
MIN_VOTES      = 2      # Votes needed to confirm a match
CONFIDENCE_GAP = 0.04   # Winner must beat runner-up by this margin
MIN_FACE_SIZE  = 80     # Minimum face bounding-box dimension (px)
MIN_EMB_NORM   = 5.0    # Embedding L2-norm floor (rejects blurry/dark faces)

# Timing
COOLDOWN               = 60    # Seconds before re-marking the same user
VERSION_CHECK_INTERVAL = 60    # Seconds between /api/embedding-version/ polls
MSG_DURATION           = 3     # Seconds an attendance message stays on screen
INFERENCE_INTERVAL     = 0.3   # Minimum seconds between DeepFace calls
MSG_CLEANUP_INTERVAL   = 5.0   # Seconds between attendance_messages GC passes
CAMERA_FAIL_LIMIT      = 30    # Consecutive frame-read failures before reconnect

# FAISS
FAISS_K    = 50   # Maximum neighbours to retrieve per query
API_RETRIES = 2   # POST retry count on transient network errors

_API_HEADERS = {"X-Internal-Key": API_KEY}


# ──────────────────────────────────────────────────────────────────────────────
# SHARED STATE
#
# Locking strategy (deadlock-free: always acquire in declaration order)
#   1. _index_lock   — protects faiss_index, faiss_uid_map, users_map
#   2. _sent_lock    — protects last_sent
#   3. _version_lock — protects local_embedding_version
#   4. _reload_lock  — protects _reload_in_progress flag
#   5. _msg_lock     — protects attendance_messages
#   6. _infer_lock   — protects _inference_in_progress flag
# ──────────────────────────────────────────────────────────────────────────────

# FAISS index + companion maps — all three swapped atomically together.
_index_lock   = threading.Lock()
faiss_index   = None          # faiss.IndexFlatIP
faiss_uid_map = []            # list[str]  parallel to index rows
users_map     = {}            # { unique_id: user_dict }

# Cooldown tracking
_sent_lock = threading.Lock()
last_sent  = {}               # { unique_id: float (timestamp) }

# Smart sync state
_version_lock           = threading.Lock()
local_embedding_version = None   # None = "not yet confirmed against server"

_reload_lock        = threading.Lock()
_reload_in_progress = False

# On-screen attendance messages
_msg_lock            = threading.Lock()
attendance_messages  = {}    # { unique_id: (message_str, timestamp) }

# Inference gate
_infer_lock            = threading.Lock()
_inference_in_progress = False
last_inference         = 0.0   # only touched from main thread — no lock needed

# Camera health  (only touched from main thread — no lock needed)
consecutive_failures = 0

# Message GC  (only touched from main thread — no lock needed)
last_msg_cleanup = 0.0

# Version-check timestamp  (only touched from main thread — no lock needed)
last_version_check = 0.0


# ──────────────────────────────────────────────────────────────────────────────
# HAAR CASCADE  (initialised once at import time)
# ──────────────────────────────────────────────────────────────────────────────

face_cascade = cv2.CascadeClassifier(
    cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
)


# ──────────────────────────────────────────────────────────────────────────────
# API HELPERS
# ──────────────────────────────────────────────────────────────────────────────

def _fetch_server_version() -> int | None:
    """
    GET /api/embedding-version/
    Returns the server's current embedding version integer, or None on failure.
    Intentionally lightweight — the server returns a single cached integer.
    """
    try:
        res = requests.get(
            VERSION_API,
            headers=_API_HEADERS,
            params={"gym_id": GYM_ID},
            timeout=5,
        )
        res.raise_for_status()
        version = res.json().get("version")
        if version is None:
            logger.warning("Version API response missing 'version' field")
        return version
    except requests.RequestException as exc:
        logger.warning("Version check failed: %s", exc)
        return None


def _fetch_users() -> list[dict]:
    """
    GET /api/get-users/
    Returns a list of user dicts with numpy embedding arrays, or [] on failure.
    """
    try:
        res = requests.get(
            USERS_API,
            headers=_API_HEADERS,
            params={"gym_id": GYM_ID},
            timeout=10,
        )
        res.raise_for_status()
        raw = res.json()

        users = []
        for u in raw:
            emb_list = [
                np.array(e, dtype=np.float32)
                for e in u.get("embeddings", [])
            ]
            if not emb_list:
                continue
            users.append({
                "unique_id":  u["unique_id"],
                "name":       u.get("name", u["unique_id"]),
                "embeddings": emb_list,
            })

        logger.info("Fetched %d users from server (gym=%s)", len(users), GYM_ID)
        return users

    except requests.RequestException as exc:
        logger.error("Failed to fetch users: %s", exc)
        return []


def _post_attendance(unique_id: str) -> dict | None:
    """
    POST /api/mark-attendance/
    Retries up to API_RETRIES times on transient network errors.
    Returns the JSON response dict, or None if all attempts fail.
    """
    for attempt in range(1, API_RETRIES + 1):
        try:
            res = requests.post(
                API_URL,
                json={"unique_id": unique_id, "gym_id": GYM_ID},
                headers=_API_HEADERS,
                timeout=5,
            )
            res.raise_for_status()
            return res.json()
        except requests.RequestException as exc:
            logger.warning(
                "Attendance POST failed for %s (attempt %d/%d): %s",
                unique_id, attempt, API_RETRIES, exc,
            )
            if attempt < API_RETRIES:
                time.sleep(1)
    return None


# ──────────────────────────────────────────────────────────────────────────────
# FAISS INDEX BUILDER
# ──────────────────────────────────────────────────────────────────────────────

def _build_index_offline(user_list: list[dict]) -> tuple:
    """
    Build a new FAISS IndexFlatIP and companion structures from user_list.

    Does NOT touch global state — everything is built locally and returned
    so the caller can perform an atomic swap.

    Returns:
        (index, uid_map, new_users_map)  on success
        (None,  [],      {})             if no valid embeddings exist
    """
    all_embeddings: list[np.ndarray] = []
    uid_map:        list[str]        = []
    new_users_map:  dict             = {}

    for u in user_list:
        uid  = u["unique_id"]
        added = 0
        new_users_map[uid] = u

        for emb in u["embeddings"]:
            norm = np.linalg.norm(emb)
            if norm == 0:
                continue
            all_embeddings.append(emb / norm)
            uid_map.append(uid)
            added += 1

        if added == 0:
            logger.warning("User %s has no valid embeddings — excluded from index", uid)

    if not all_embeddings:
        logger.warning("No valid embeddings found — FAISS index not built")
        return None, [], {}

    matrix = np.array(all_embeddings, dtype=np.float32)
    dim    = matrix.shape[1]
    index  = faiss.IndexFlatIP(dim)
    index.add(matrix)

    avg_emb = len(all_embeddings) / len(user_list) if user_list else 0
    logger.info(
        "FAISS index built offline: %d embeddings | %d users | "
        "avg %.1f emb/user | dim=%d",
        index.ntotal, len(user_list), avg_emb, dim,
    )
    return index, uid_map, new_users_map


def _atomic_swap(new_index, new_uid_map: list, new_users_map: dict) -> None:
    """
    Replace the live index, uid_map, and users_map in one locked operation.
    Recognition threads holding the old references will finish safely;
    new recognition threads will pick up the new index immediately.
    """
    global faiss_index, faiss_uid_map, users_map

    with _index_lock:
        faiss_index   = new_index
        faiss_uid_map = new_uid_map
        users_map     = new_users_map

    logger.info(
        "Atomic FAISS swap complete: %d embeddings | %d users",
        new_index.ntotal, len(new_users_map),
    )


# ──────────────────────────────────────────────────────────────────────────────
# SMART SYNC
# ──────────────────────────────────────────────────────────────────────────────

def _full_reload(server_version: int) -> bool:
    """
    Download users, build a new FAISS index offline, swap atomically,
    then record the server version locally.

    Returns True on success, False if the reload should be skipped
    (empty user list or index-build failure).
    """
    t0 = time.monotonic()

    user_list = _fetch_users()
    if not user_list:
        logger.warning(
            "Reload aborted — server returned empty user list; "
            "keeping existing index and version"
        )
        return False

    new_index, new_uid_map, new_users_map = _build_index_offline(user_list)
    if new_index is None:
        logger.warning(
            "Reload aborted — index build failed; "
            "keeping existing index and version"
        )
        return False

    _atomic_swap(new_index, new_uid_map, new_users_map)

    with _version_lock:
        local_embedding_version = server_version  # noqa: F841  (updates global)
        # Re-assign the global directly (Python scoping requires this pattern)

    # The assignment above only sets a local; we need to update the global.
    # Use a module-level setter to avoid the global-keyword anti-pattern in
    # nested scopes.
    _set_local_version(server_version)

    elapsed = time.monotonic() - t0
    logger.info(
        "Full reload complete in %.2fs — version=%d | users=%d | embeddings=%d",
        elapsed, server_version, len(new_users_map), new_index.ntotal,
    )
    return True


def _set_local_version(version: int) -> None:
    """Thread-safe setter for local_embedding_version."""
    global local_embedding_version
    with _version_lock:
        local_embedding_version = version


def _get_local_version() -> int | None:
    """Thread-safe getter for local_embedding_version."""
    with _version_lock:
        return local_embedding_version


def _smart_sync_worker() -> None:
    """
    Background worker (runs in a daemon thread):
      1. Poll /api/embedding-version/  — one integer, very cheap.
      2. Compare to local version.
      3. If unchanged → do nothing (the common case).
      4. If changed   → full reload with atomic FAISS swap.
    """
    global _reload_in_progress

    try:
        server_version = _fetch_server_version()

        if server_version is None:
            logger.warning("Smart sync: version check returned None — skipping this cycle")
            return

        current_local = _get_local_version()

        if current_local is not None and server_version == current_local:
            logger.info(
                "Smart sync: version unchanged (v%d) — no reload needed",
                server_version,
            )
            return

        logger.info(
            "Smart sync: version mismatch detected (local=%s → server=%d) — reloading",
            current_local, server_version,
        )
        _full_reload(server_version)

    except Exception:
        logger.exception("Unexpected error in smart sync worker")
    finally:
        with _reload_lock:
            _reload_in_progress = False


# ──────────────────────────────────────────────────────────────────────────────
# RECOGNITION
# ──────────────────────────────────────────────────────────────────────────────

def _find_best_match(face_emb: np.ndarray) -> tuple:
    """
    Search the FAISS index using top-K majority voting.

    Takes a snapshot of the index and uid_map under the lock, then releases
    immediately — the actual search runs outside the lock, keeping the
    critical section as short as possible.

    Returns (user_dict, avg_score) or (None, 0.0).
    """
    with _index_lock:
        index   = faiss_index
        uid_map = list(faiss_uid_map)       # shallow copy of string list — fast
        u_map   = users_map                 # reference; dict entries are stable

    if index is None or index.ntotal == 0:
        return None, 0.0

    norm = np.linalg.norm(face_emb)
    if norm == 0:
        return None, 0.0

    K     = min(index.ntotal, FAISS_K)
    query = (face_emb / norm).reshape(1, -1).astype(np.float32)
    scores, idxs = index.search(query, k=K)

    # Collect per-UID votes above threshold
    vote_scores: dict[str, list[float]] = {}
    for rank in range(K):
        idx   = int(idxs[0][rank])
        score = float(scores[0][rank])
        if idx == -1 or score < THRESHOLD:
            break   # FAISS returns results in descending score order
        uid = uid_map[idx]
        vote_scores.setdefault(uid, []).append(score)

    if not vote_scores:
        return None, 0.0

    # Rank by (vote_count, mean_score) — most votes wins; ties broken by score
    ranked = sorted(
        vote_scores.items(),
        key=lambda item: (len(item[1]), float(np.mean(item[1]))),
        reverse=True,
    )

    best_uid, best_scores = ranked[0]
    best_votes = len(best_scores)
    best_avg   = float(np.mean(best_scores))

    if best_votes < MIN_VOTES:
        logger.debug(
            "Match rejected: %s — only %d vote(s) (need %d)",
            best_uid, best_votes, MIN_VOTES,
        )
        return None, 0.0

    if len(ranked) > 1:
        second_avg = float(np.mean(ranked[1][1]))
        gap        = best_avg - second_avg
        if gap < CONFIDENCE_GAP:
            logger.debug(
                "Match ambiguous: %s(%.3f) vs %s(%.3f) — gap=%.3f < %.3f",
                best_uid, best_avg, ranked[1][0], second_avg, gap, CONFIDENCE_GAP,
            )
            return None, 0.0

    logger.debug(
        "Match confirmed: %s | votes=%d | avg_score=%.3f",
        best_uid, best_votes, best_avg,
    )

    user = u_map.get(best_uid)
    return (user, best_avg) if user else (None, 0.0)


# ──────────────────────────────────────────────────────────────────────────────
# ATTENDANCE DISPATCH
# ──────────────────────────────────────────────────────────────────────────────

def _send_attendance_worker(uid: str, name: str, timestamp: float) -> None:
    """Background thread: POST attendance and update the on-screen message."""
    result = _post_attendance(uid)

    if result is None:
        # All retries failed — release the cooldown so the next recognition
        # attempt can try again.
        with _sent_lock:
            last_sent.pop(uid, None)
        logger.warning(
            "Attendance failed for %s after %d attempt(s) — cooldown released",
            uid, API_RETRIES,
        )
        return

    status = result.get("status", "")
    if status == "success":
        msg = f"✔ Attendance Marked: {uid} - {name}"
        threading.Thread(target=_play_sound, daemon=True).start()
    elif status == "exists":
        msg = f"⚠ Already Marked: {uid} - {name}"
        threading.Thread(target=_play_sound, daemon=True).start()
    else:
        msg = f"❌ Error for {uid}: {result.get('message', 'unknown')}"
        with _sent_lock:
            last_sent.pop(uid, None)

    logger.info(msg)
    with _msg_lock:
        attendance_messages[uid] = (msg, timestamp)


# ──────────────────────────────────────────────────────────────────────────────
# DEEPFACE INFERENCE WORKER
# ──────────────────────────────────────────────────────────────────────────────

def _inference_worker(frame: np.ndarray, current_time: float) -> None:
    """
    Background thread: run DeepFace on a single frame, match each detected
    face, and dispatch attendance for any confirmed match not in cooldown.
    """
    global _inference_in_progress

    try:
        face_results = DeepFace.represent(
            img_path=frame,
            model_name="Facenet",
            enforce_detection=False,
            detector_backend="opencv",
        )

        if not face_results:
            return

        processed_in_frame: set[str] = set()

        for face_data in face_results:
            region = face_data.get("facial_area", {})
            fw     = region.get("w", 0)
            fh     = region.get("h", 0)

            if fw < MIN_FACE_SIZE or fh < MIN_FACE_SIZE:
                continue

            face_emb = np.array(face_data["embedding"], dtype=np.float32)
            if np.linalg.norm(face_emb) < MIN_EMB_NORM:
                continue

            matched_user, score = _find_best_match(face_emb)
            if matched_user is None:
                continue

            uid  = matched_user["unique_id"]
            name = matched_user.get("name", uid)

            if uid in processed_in_frame:
                continue
            processed_in_frame.add(uid)

            with _sent_lock:
                in_cooldown = (
                    uid in last_sent
                    and current_time - last_sent[uid] < COOLDOWN
                )
                if not in_cooldown:
                    last_sent[uid] = current_time   # optimistic lock

            if in_cooldown:
                continue

            logger.info("Match → %s | %s | score=%.3f", uid, name, score)
            threading.Thread(
                target=_send_attendance_worker,
                args=(uid, name, current_time),
                daemon=True,
            ).start()

    except Exception:
        logger.exception("DeepFace inference error")
    finally:
        with _infer_lock:
            _inference_in_progress = False


# ──────────────────────────────────────────────────────────────────────────────
# CAMERA HELPER
# ──────────────────────────────────────────────────────────────────────────────

def _try_reconnect(cap: cv2.VideoCapture) -> bool:
    """Release and re-open the default camera. Returns True on success."""
    logger.warning("Camera reconnect attempt...")
    cap.release()
    time.sleep(1)
    cap.open(0)
    if cap.isOpened():
        logger.info("Camera reconnected successfully")
        return True
    logger.error("Camera reconnect failed")
    return False


# ──────────────────────────────────────────────────────────────────────────────
# STARTUP  (Issue 4 — race-free sequence)
#
#  Correct order:
#    1. Fetch server version FIRST  (establishes our baseline)
#    2. Download users
#    3. Build FAISS
#    4. Only on success: store local version
#
#  This ensures local_embedding_version is never newer than the loaded data.
# ──────────────────────────────────────────────────────────────────────────────

if GYM_ID == "your-gym-uuid-here":
    print("❌ GYM_ID is not set!")
    print("   Edit this file and replace 'your-gym-uuid-here'")
    print("   with your gym UUID from Django admin → Gyms.")
    raise SystemExit(1)

logger.info("━━━ Face Attendance System starting ━━━")

# Step 1: anchor the version before fetching data
logger.info("Startup [1/4] Fetching server embedding version...")
_startup_version = _fetch_server_version()
if _startup_version is not None:
    logger.info("Startup embedding version: v%d", _startup_version)
else:
    logger.warning(
        "Could not fetch startup embedding version — "
        "will attempt version sync after first interval"
    )

# Step 2 & 3: fetch users and build index
logger.info("Startup [2/4] Fetching users...")
_startup_users = _fetch_users()

logger.info("Startup [3/4] Building FAISS index...")
_startup_index, _startup_uid_map, _startup_users_map = _build_index_offline(_startup_users)

if _startup_index is not None:
    _atomic_swap(_startup_index, _startup_uid_map, _startup_users_map)

    # Step 4: only record version AFTER successful index build
    if _startup_version is not None:
        _set_local_version(_startup_version)
        logger.info("Startup [4/4] Local version set to v%d", _startup_version)
    else:
        logger.warning(
            "Startup [4/4] Local version not set (fetch failed) — "
            "first sync cycle will trigger a full reload"
        )
else:
    logger.error(
        "Startup FAISS build failed — starting without recognition capability"
    )

# Warm up DeepFace so the first real frame isn't slow
logger.info("Startup warming up DeepFace model...")
try:
    DeepFace.represent(
        img_path=np.zeros((160, 160, 3), dtype=np.uint8),
        model_name="Facenet",
        enforce_detection=False,
        detector_backend="opencv",
    )
    logger.info("DeepFace model ready")
except Exception as _e:
    logger.error("DeepFace warmup failed: %s", _e)
    raise SystemExit(1)

# Seed the version-check timestamp so we don't immediately re-poll
last_version_check = time.time()

# ──────────────────────────────────────────────────────────────────────────────
# CAMERA SETUP
# ──────────────────────────────────────────────────────────────────────────────

video = cv2.VideoCapture(0)
if not video.isOpened():
    logger.error("Could not open camera — exiting")
    raise SystemExit(1)

cv2.namedWindow("Face Attendance", cv2.WINDOW_NORMAL)
cv2.resizeWindow("Face Attendance", 900, 600)
logger.info("Camera started — press ESC or Q to exit\n")


# ──────────────────────────────────────────────────────────────────────────────
# MAIN LOOP
# ──────────────────────────────────────────────────────────────────────────────

while True:
    ret, frame = video.read()

    if not ret:
        consecutive_failures += 1
        if consecutive_failures >= CAMERA_FAIL_LIMIT:
            if not _try_reconnect(video):
                logger.error("Cannot recover camera — exiting")
                break
            consecutive_failures = 0
        time.sleep(0.05)
        continue

    consecutive_failures = 0
    current_time  = time.time()
    display_frame = frame.copy()

    # ── Haar pre-screen ───────────────────────────────────────────────────────
    gray       = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    haar_faces = face_cascade.detectMultiScale(
        gray, scaleFactor=1.3, minNeighbors=5, minSize=(60, 60)
    )

    if len(haar_faces) == 0:
        cv2.putText(display_frame, "No Face Detected", (20, 50),
                    cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
    else:
        cv2.putText(
            display_frame,
            f"Scanning {len(haar_faces)} face(s)...",
            (20, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2,
        )

        with _infer_lock:
            can_infer = (
                not _inference_in_progress
                and current_time - last_inference >= INFERENCE_INTERVAL
            )
            if can_infer:
                _inference_in_progress = True
                last_inference = current_time

        if can_infer:
            threading.Thread(
                target=_inference_worker,
                args=(frame.copy(), current_time),
                daemon=True,
            ).start()

    # ── Attendance message overlay ────────────────────────────────────────────
    with _msg_lock:
        active_msgs = [
            (uid, msg, ts)
            for uid, (msg, ts) in attendance_messages.items()
            if current_time - ts < MSG_DURATION
        ]
        # Periodic GC: drop stale messages
        if current_time - last_msg_cleanup > MSG_CLEANUP_INTERVAL:
            cutoff = current_time - MSG_DURATION * 2
            stale  = [uid for uid, (_, ts) in attendance_messages.items() if ts < cutoff]
            for uid in stale:
                del attendance_messages[uid]
            last_msg_cleanup = current_time

    for i, (_, msg, _ts) in enumerate(active_msgs):
        cv2.putText(
            display_frame, msg, (20, 100 + i * 35),
            cv2.FONT_HERSHEY_SIMPLEX, 0.75, (0, 255, 255), 2,
        )

    # ── Stats overlay ─────────────────────────────────────────────────────────
    with _index_lock:
        total_indexed = faiss_index.ntotal if faiss_index else 0
        total_users   = len(users_map)
    display_version = _get_local_version()

    stats = (
        f"Users: {total_users} | Indexed: {total_indexed} | "
        f"Inference: {round(1 / INFERENCE_INTERVAL)}hz | "
        f"Threshold: {THRESHOLD} | MinVotes: {MIN_VOTES} | "
        f"Gap: {CONFIDENCE_GAP} | EmbVer: {display_version or '?'}"
    )
    cv2.putText(
        display_frame, stats,
        (10, display_frame.shape[0] - 10),
        cv2.FONT_HERSHEY_SIMPLEX, 0.45, (180, 180, 180), 1,
    )

    cv2.imshow("Face Attendance", display_frame)

    key = cv2.waitKey(1) & 0xFF
    if key in (27, ord("q")):
        logger.info("Exit key pressed — shutting down")
        break

    # ── Smart sync ────────────────────────────────────────────────────────────
    if current_time - last_version_check > VERSION_CHECK_INTERVAL:
        with _reload_lock:
            if not _reload_in_progress:
                _reload_in_progress = True
                last_version_check  = current_time
                threading.Thread(
                    target=_smart_sync_worker,
                    daemon=True,
                ).start()
                logger.debug("Smart sync: version-check thread launched")


# ──────────────────────────────────────────────────────────────────────────────
# CLEANUP
# ──────────────────────────────────────────────────────────────────────────────

if video.isOpened():
    video.release()

if _SOUND_AVAILABLE:
    pygame.mixer.quit()

cv2.destroyAllWindows()
logger.info("Shutdown complete")