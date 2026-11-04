import hmac
import json
import uuid
from functools import wraps

from django.conf import settings
from django.core import signing
from django.http import JsonResponse

from .models import Company, CompanyAdmin

SALT = "staff-login"
TOKEN_MAX_AGE = 12 * 3600  # 12 hours


def make_token(admin):
    return signing.dumps({"a": admin.id, "c": str(admin.company_id)}, salt=SALT)


def read_token(token):
    """Returns the claims, or raises signing.SignatureExpired / signing.BadSignature."""
    return signing.loads(token, salt=SALT, max_age=TOKEN_MAX_AGE)


def _err(message, status, code):
    return JsonResponse({"status": "error", "code": code, "message": message}, status=status)


def _valid_uuid(value):
    try:
        uuid.UUID(str(value))
        return True
    except ValueError:
        return False


def _requested_company(request):
    cid = request.GET.get("company_id") or request.POST.get("company_id")
    if not cid and request.body:
        try:
            body = json.loads(request.body)
            cid = body.get("company_id") if isinstance(body, dict) else None
        except ValueError:
            pass
    return str(cid) if cid else None


def company_auth(view):
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        requested = _requested_company(request)
        header = request.headers.get("Authorization", "")

        if header:
            if not header.startswith("Bearer "):
                return _err("Invalid session.", 401, "invalid_token")
            try:
                claims = read_token(header[7:].strip())
            except signing.SignatureExpired:
                return _err("Session expired.", 401, "token_expired")
            except signing.BadSignature:
                return _err("Invalid session.", 401, "invalid_token")

            admin = (
                CompanyAdmin.objects.select_related("company")
                .filter(
                    id=claims.get("a"), company_id=claims.get("c"),
                    is_active=True, company__is_active=True,
                )
                .first()
            )
            if admin is None:
                return _err("This account is no longer active.", 401, "inactive")
            if requested and requested != str(admin.company_id):
                return _err("Forbidden.", 403, "forbidden")

            request.company = admin.company
            request.company_id = str(admin.company_id)
            request.admin_id = admin.id
            return view(request, *args, **kwargs)

        key = request.headers.get("X-Internal-Key", "")
        expected = getattr(settings, "INTERNAL_API_KEY", "")
        if key and expected and hmac.compare_digest(key.encode(), expected.encode()):
            if not requested or not _valid_uuid(requested):
                return _err("A valid company_id is required.", 400, "company_required")
            company = Company.objects.filter(id=requested, is_active=True).first()
            if company is None:
                return _err("Unknown company.", 404, "company_not_found")
            request.company = company
            request.company_id = str(company.id)
            request.admin_id = None
            return view(request, *args, **kwargs)

        return _err("Unauthorized.", 401, "unauthorized")
    return wrapper