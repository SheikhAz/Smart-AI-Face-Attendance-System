import json
from urllib.parse import urlparse

from django.core.cache import cache
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

import hmac
import uuid
from django.conf import settings
from company.auth import TOKEN_MAX_AGE, _err, company_auth, make_token
from company.models import Company, CompanyAdmin, Staff
from company.enroll_frame import bump_embedding_version

MAX_FAILS = 5
LOCK_SECONDS = 15 * 60


def _host(link):
    link = (link or "").strip()
    if not link:
        return ""
    if "://" not in link:
        link = "https://" + link
    return (urlparse(link).hostname or "").lower()


@csrf_exempt
@require_POST
def staff_login(request):
    try:
        data = json.loads(request.body or "{}")
    except ValueError:
        return JsonResponse({"status": "error", "message": "Invalid request."}, status=400)

    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    host = _host(data.get("link")) or request.get_host().split(":")[0].lower()

    # Brute-force guard: per IP + company + email
    key = f"login-fail:{request.META.get('REMOTE_ADDR', '')}:{host}:{email}"
    if cache.get(key, 0) >= MAX_FAILS:
        return JsonResponse(
            {"status": "error", "message": "Too many attempts. Try again in 15 minutes."},
            status=429,
        )

    company = Company.objects.filter(domain=host, is_active=True).first()
    admin = (
        CompanyAdmin.objects.filter(company=company, email=email, is_active=True).first()
        if company else None
    )

    if not (admin and admin.check_password(password)):
        cache.set(key, cache.get(key, 0) + 1, LOCK_SECONDS)
        # One generic message so nobody can tell which part was wrong
        return JsonResponse(
            {"status": "error", "message": "Link, email or password did not match."},
            status=401,
        )

    cache.delete(key)
    admin.last_login = timezone.now()
    admin.save(update_fields=["last_login"])

    return JsonResponse({
        "status": "success",
        "token": make_token(admin),
        "company_id": str(company.id),
        "company": company.name,
        "expires_in": TOKEN_MAX_AGE,
    })


@require_GET
@company_auth
def staff_me(request):
    email = (
        CompanyAdmin.objects.filter(id=request.admin_id).values_list("email", flat=True).first()
        if request.admin_id else None
    )
    return JsonResponse({
        "status": "success",
        "company_id": request.company_id,
        "company": request.company.name,
        "email": email,
    })

def _internal_company(request, gym_id):
    """Auth for add_face.py: X-Internal-Key header + the company id it sends as gym_id."""
    key = request.headers.get("X-Internal-Key", "")
    secret = settings.INTERNAL_API_KEY or ""
    if not secret or not hmac.compare_digest(key.encode(), secret.encode()):
        return None
    try:
        return Company.objects.filter(id=uuid.UUID(str(gym_id)), is_active=True).first()
    except ValueError:
        return None


@company_auth
def _browser_users(request):
    # The browser only gets counts, never the raw face embeddings.
    rows = Staff.objects.filter(company=request.company, is_active=True)
    return JsonResponse(
        [{"unique_id": s.unique_id, "name": s.name, "embedding_count": len(s.embeddings or [])}
         for s in rows],
        safe=False,
    )


@require_GET
def get_users(request):
    if request.headers.get("X-Internal-Key"):          # called by add_face.py
        company = _internal_company(request, request.GET.get("gym_id"))
        if company is None:
            return _err("Unauthorized.", 401, "bad_internal_key")
        rows = Staff.objects.filter(company=company, is_active=True)
        return JsonResponse(
            [{"unique_id": s.unique_id, "name": s.name, "embeddings": s.embeddings} for s in rows],
            safe=False,
        )
    return _browser_users(request)                      # called by the React app


@csrf_exempt
@require_POST
def save_embeddings_batch(request):
    try:
        data = json.loads(request.body or "{}")
    except ValueError:
        return _err("Invalid request.", 400, "bad_json")
    if not isinstance(data, dict):
        return _err("Invalid request.", 400, "bad_json")

    company = _internal_company(request, data.get("gym_id"))
    if company is None:
        return _err("Unauthorized.", 401, "bad_internal_key")

    embs = data.get("embeddings")
    valid = (
        isinstance(embs, list) and 1 <= len(embs) <= 50
        and all(
            isinstance(e, list) and 1 <= len(e) <= 1024
            and all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in e)
            for e in embs
        )
    )
    if not valid:
        return _err("embeddings must be a list of numeric vectors.", 400, "bad_embeddings")

    staff = Staff.objects.filter(
        company=company, unique_id=str(data.get("unique_id", "")), is_active=True
    ).first()
    if staff is None:
        return _err("Staff member not found.", 404, "staff_not_found")

    staff.embeddings = embs        # re-enrolling replaces the old set
    staff.save(update_fields=["embeddings"])
    bump_embedding_version(company.id)
    return JsonResponse({"status": "success", "saved": len(embs)})