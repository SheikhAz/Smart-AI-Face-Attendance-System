"""Browser-camera recognition: one frame in, matched staff member out."""
import json
import threading
import time

import faiss
import numpy as np
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from .auth import _err, company_auth
from .enroll_frame import _add_face, _decode, _infer_lock, embedding_version
from .models import Staff

THRESHOLD = 0.82        # same values as attendance.py
MIN_VOTES = 2
CONFIDENCE_GAP = 0.04
MIN_FACE_SIZE = 80
FAISS_K = 50
INDEX_TTL = 60          # safety net if a version bump is ever missed

_indexes = {}           # company_id -> entry
_indexes_lock = threading.Lock()


def _get_index(company):
    cid, ver = str(company.id), embedding_version(company.id)
    with _indexes_lock:
        e = _indexes.get(cid)
        if e and e["ver"] == ver and time.time() - e["built"] < INDEX_TTL:
            return e

    vecs, uids, names = [], [], {}
    for s in Staff.objects.filter(company=company, is_active=True):
        for emb in s.embeddings or []:
            v = np.array(emb, dtype=np.float32)
            n = np.linalg.norm(v)
            if n == 0:
                continue
            vecs.append(v / n)
            uids.append(s.unique_id)
            names[s.unique_id] = s.name

    entry = {"ver": ver, "built": time.time(), "index": None, "uids": uids, "names": names}
    if vecs:
        m = np.array(vecs, dtype=np.float32)
        ix = faiss.IndexFlatIP(m.shape[1])
        ix.add(m)
        entry["index"] = ix
    with _indexes_lock:
        _indexes[cid] = entry
    return entry


def _match(entry, emb):
    ix = entry["index"]
    n = np.linalg.norm(emb)
    if ix is None or n == 0:
        return None
    k = min(ix.ntotal, FAISS_K)
    scores, idxs = ix.search((emb / n).reshape(1, -1).astype(np.float32), k)

    votes = {}
    for s, i in zip(scores[0], idxs[0]):
        if i == -1 or s < THRESHOLD:
            break                       # results come back in descending score order
        votes.setdefault(entry["uids"][int(i)], []).append(float(s))
    if not votes:
        return None

    ranked = sorted(votes.items(),
                    key=lambda kv: (len(kv[1]), float(np.mean(kv[1]))), reverse=True)
    uid, sc = ranked[0]
    if len(sc) < MIN_VOTES:
        return None
    if len(ranked) > 1 and float(np.mean(sc)) - float(np.mean(ranked[1][1])) < CONFIDENCE_GAP:
        return None                     # ambiguous between two people
    return uid


@csrf_exempt
@require_POST
@company_auth
def recognize_frame(request):
    try:
        data = json.loads(request.body or "{}")
    except ValueError:
        return _err("Invalid request.", 400, "bad_json")
    if not isinstance(data, dict):
        return _err("Invalid request.", 400, "bad_json")

    frame = _decode(data.get("image"))
    if frame is None:
        return _err("Bad image.", 400, "bad_image")

    af = _add_face()
    with _infer_lock:
        emb, area = af.extract_embedding(frame)
    if emb is None:
        return JsonResponse({"status": "none", "reason": "no_face"})
    if (area or {}).get("w", 0) < MIN_FACE_SIZE or (area or {}).get("h", 0) < MIN_FACE_SIZE:
        return JsonResponse({"status": "none", "reason": "too_small"})

    entry = _get_index(request.company)     # only this company's staff, never others
    uid = _match(entry, emb)
    if uid is None:
        return JsonResponse({"status": "none", "reason": "no_match"})
    return JsonResponse({"status": "success", "unique_id": uid, "name": entry["names"][uid]})
