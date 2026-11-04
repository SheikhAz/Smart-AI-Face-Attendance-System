"""Browser-camera enrollment: React posts frames, the server runs add_face's functions on them."""
import base64
import json
import re
import sys
import threading
from pathlib import Path
import time
import cv2
import numpy as np
from django.conf import settings
from django.core.cache import cache
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from .auth import _err, company_auth
from .models import Staff

UID_RE = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")
TARGET = 10          # keep in sync with add_face.MAX_EMBEDDINGS
MIN_KEEP = 3         # keep in sync with add_face.MIN_EMBEDDINGS
SESSION_TTL = 600
MAX_IMAGE_CHARS = 3_000_000

_infer_lock = threading.Lock()   # one TF inference at a time
_af = None




def _add_face():
    global _af
    if _af is None:
        src = str(getattr(settings, "ENROLL_SOURCE_DIR", Path(settings.BASE_DIR).parent / "source"))
        if src not in sys.path:
            sys.path.insert(0, src)
        import add_face         # pyright: ignore[reportMissingImports]
        _af = add_face
    return _af


def _decode(data_url):
    if not isinstance(data_url, str) or len(data_url) > MAX_IMAGE_CHARS:
        return None
    try:
        raw = base64.b64decode(data_url.split(",", 1)[-1])
        return cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    except Exception:
        return None


def _vecs(embs):
    return [np.array(e, dtype=np.float32) for e in embs]

def bump_embedding_version(company_id):
    cache.set(f"emb-version:{company_id}", time.time_ns(), None)


def embedding_version(company_id):
    return cache.get(f"emb-version:{company_id}")

@csrf_exempt
@require_POST
@company_auth
def enroll_frame(request):
    try:
        data = json.loads(request.body or "{}")
    except ValueError:
        return _err("Invalid request.", 400, "bad_json")
    if not isinstance(data, dict):
        return _err("Invalid request.", 400, "bad_json")

    uid = str(data.get("unique_id", "")).strip()
    if not UID_RE.match(uid):
        return _err("A valid unique_id is required.", 400, "bad_unique_id")
    staff = Staff.objects.filter(company=request.company, unique_id=uid, is_active=True).first()
    if staff is None:
        return _err("Staff member not found.", 404, "staff_not_found")

    key = f"enroll-frames:{request.company_id}:{uid}"   # scoped per company + staff
    embs = [] if data.get("reset") else cache.get(key, [])
    finalize = bool(data.get("finalize"))
    reason, captured = "", False
    af = _add_face()

    if not finalize:
        frame = _decode(data.get("image"))
        if frame is None:
            return _err("Bad image.", 400, "bad_image")
        with _infer_lock:
            emb, _area = af.extract_embedding(frame)
        if emb is None:
            reason = "no_face"
        elif not af.is_diverse_enough(emb, _vecs(embs)):
            reason = "too_similar"
        else:
            embs.append(emb.tolist())
            captured = True

    ready = len(embs) >= TARGET or (finalize and len(embs) >= MIN_KEEP)
    if finalize and len(embs) < MIN_KEEP:
        cache.delete(key)
        return _err("Not enough clear captures. Try again with better lighting.", 400, "too_few")

    if not ready:
        cache.set(key, embs, SESSION_TTL)
        return JsonResponse({"status": "success", "captured": captured, "reason": reason,
                             "progress": len(embs), "target": TARGET, "done": False})

    # Finished: duplicate check against the other staff of THIS company, then save.
    others = [{"unique_id": s.unique_id, "embeddings": s.embeddings or []}
              for s in Staff.objects.filter(company=request.company, is_active=True).exclude(pk=staff.pk)]
    is_dup, _dup_id, _score = af.check_duplicate(_vecs(embs), others, exclude_uid=uid)
    cache.delete(key)
    if is_dup:
        return _err("This face already matches another staff member.", 409, "duplicate_face")

    staff.embeddings = embs            # re-enrolling replaces the old set, same as the batch endpoint
    staff.save(update_fields=["embeddings"])
    bump_embedding_version(request.company_id)
    return JsonResponse({"status": "success", "captured": captured, "reason": "",
                         "progress": len(embs), "target": TARGET, "done": True})