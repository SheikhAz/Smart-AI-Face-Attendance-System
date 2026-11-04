import uuid
import django
from django.db import models
from django.contrib.auth.hashers import make_password, check_password
from urllib.parse import urlparse
from django.core.validators import RegexValidator

class Company(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=150)
    domain = models.CharField(
        max_length=255, unique=True,
        help_text="Host people type as the company link, e.g. golden-gym.entergym.in",
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        value = (self.domain or "").strip().lower()
        if "://" not in value:
            value = "//" + value
        self.domain = urlparse(value).hostname or ""
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class CompanyAdmin(models.Model):
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="admins")
    email = models.EmailField()
    password = models.CharField(max_length=128)
    is_active = models.BooleanField(default=True)
    last_login = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = ("company", "email")

    def save(self, *args, **kwargs):
        self.email = self.email.strip().lower()
        super().save(*args, **kwargs)

    def set_password(self, raw):
        self.password = make_password(raw)

    def check_password(self, raw):
        return check_password(raw, self.password)

    def __str__(self):
        return f"{self.email} @ {self.company.name}"


class Staff(models.Model):
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="staff")
    unique_id = models.CharField(
        max_length=64,
        validators=[RegexValidator(r"^[A-Za-z0-9_.-]{1,64}$", "Letters, digits, _ . - only.")],
    )
    name = models.CharField(max_length=150)
    embeddings = models.JSONField(default=list, blank=True)  # list of face vectors
    face_image_url = models.URLField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("company", "unique_id")
        ordering = ["unique_id"]

    def __str__(self):
        return f"{self.unique_id} - {self.name}"