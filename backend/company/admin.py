from django.contrib import admin
from .models import Company, CompanyAdmin ,Staff


@admin.register(Company)
class CompanyAdminPanel(admin.ModelAdmin):
    list_display = ("name", "domain", "id", "is_active")


@admin.register(CompanyAdmin)
class CompanyLoginAdminPanel(admin.ModelAdmin):
    list_display = ("email", "company", "is_active", "last_login")

    def save_model(self, request, obj, form, change):
        # Type a plain password in the admin form; it is hashed here.
        if "password" in form.changed_data or not change:
            obj.set_password(obj.password)
        super().save_model(request, obj, form, change)

@admin.register(Staff)
class StaffAdmin(admin.ModelAdmin):
    list_display = ("unique_id", "name", "company", "face_count", "is_active")
    list_filter = ("company", "is_active")
    search_fields = ("unique_id", "name")
    readonly_fields = ("embeddings",)

    def face_count(self, obj):
        return len(obj.embeddings or [])