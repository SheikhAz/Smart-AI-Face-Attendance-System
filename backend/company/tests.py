import shutil
import tempfile
import time
from pathlib import Path

from django.conf import settings
from django.test import TestCase, override_settings

from . import enroll
from .models import Company, CompanyAdmin

STUB = '''
import os, time
def load_users(use_cache=True):
    ok = os.environ.get("COMPANY_ID") and os.environ.get("INTERNAL_API_KEY")
    return [{"unique_id": u} for u in ("STF001", "DUP", "SLOW")] if ok else []
def select_user(users): return None
def enroll():
    uid = select_user([])
    print("🎯 Enrolling:", uid, flush=True)
    if uid == "SLOW":
        print("   📸 Captured embedding 1/3", flush=True); time.sleep(60)
    if uid == "DUP":
        print("⚠️  Duplicate face detected!", flush=True)
        if input("   Continue enrollment anyway? (y/n): ") != "y":
            print("❌ Enrollment cancelled."); return
    for i in range(1, 4):
        print(f"   📸 Captured embedding {i}/3", flush=True); time.sleep(0.1)
    print("✅ Enrollment complete!")
'''


class EnrollTests(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.tmp = tempfile.mkdtemp()
        runner = Path(settings.BASE_DIR).parent / "source" / "enroll_runner.py"
        shutil.copy(runner, Path(cls.tmp) / "enroll_runner.py")
        (Path(cls.tmp) / "add_face.py").write_text(STUB, encoding="utf-8")
        cls.override = override_settings(ENROLL_SOURCE_DIR=cls.tmp)
        cls.override.enable()

    @classmethod
    def tearDownClass(cls):
        cls.override.disable()
        shutil.rmtree(cls.tmp, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.a = Company.objects.create(name="Alpha", domain="alpha.example.com")
        self.b = Company.objects.create(name="Beta", domain="beta.example.com")
        for c, e in ((self.a, "a@alpha.com"), (self.b, "b@beta.com")):
            adm = CompanyAdmin(company=c, email=e)
            adm.set_password("pw-12345")
            adm.save()
        self.ta = self._token("alpha.example.com", "a@alpha.com")
        self.tb = self._token("beta.example.com", "b@beta.com")

    def tearDown(self):
        for j in list(enroll._jobs.values()):
            if j["status"] == "running":
                j["cancelled"] = True
                j["proc"].kill()
        time.sleep(0.3)
        enroll._jobs.clear()

    def _token(self, link, email):
        r = self.client.post("/api/staff-login/", data={"link": link, "email": email, "password": "pw-12345"},
                             content_type="application/json")
        return r.json()["token"]

    def start(self, uid, tok=None):
        return self.client.post("/api/start-enroll/", data={"unique_id": uid},
                                content_type="application/json", HTTP_AUTHORIZATION=f"Bearer {tok or self.ta}")

    def status(self, job, tok=None):
        return self.client.get(f"/api/enroll-status/?job_id={job}", HTTP_AUTHORIZATION=f"Bearer {tok or self.ta}")

    def wait(self, job, secs=25):
        end = time.time() + secs
        while time.time() < end:
            d = self.status(job).json()
            if d["status"] != "running":
                return d
            time.sleep(0.2)
        self.fail("job did not finish")

    def test_requires_auth(self):
        r = self.client.post("/api/start-enroll/", data={"unique_id": "STF001"}, content_type="application/json")
        self.assertEqual(r.status_code, 401)
        self.assertEqual(self.client.get("/api/enroll-status/?job_id=x").status_code, 401)

    def test_rejects_bad_unique_id(self):
        for bad in ("", "a b", "x;rm -rf /", "../x", "a" * 65):
            self.assertEqual(self.start(bad).status_code, 400, bad)

    def test_success_flow_passes_env_and_progress(self):
        r = self.start("STF001")
        self.assertEqual(r.status_code, 200)
        d = self.wait(r.json()["job_id"])
        self.assertEqual((d["status"], d["progress"], d["target"]), ("success", 3, 3))

    def test_unknown_staff(self):
        d = self.wait(self.start("NOPE").json()["job_id"])
        self.assertEqual(d["status"], "failed")
        self.assertIn("not found", d["message"])

    def test_duplicate_face_is_not_enrolled(self):
        d = self.wait(self.start("DUP").json()["job_id"])
        self.assertEqual(d["status"], "failed")
        self.assertIn("already matches", d["message"])

    def test_busy_then_cancel(self):
        job = self.start("SLOW").json()["job_id"]
        self.assertEqual(self.start("STF001", self.tb).status_code, 409)
        c = self.client.post("/api/enroll-cancel/", data={"job_id": job}, content_type="application/json",
                             HTTP_AUTHORIZATION=f"Bearer {self.ta}")
        self.assertEqual(c.json()["status"], "cancelling")
        self.assertEqual(self.wait(job)["status"], "cancelled")

    def test_other_company_cannot_see_or_cancel_job(self):
        job = self.start("SLOW").json()["job_id"]
        self.assertEqual(self.status(job, self.tb).status_code, 404)
        c = self.client.post("/api/enroll-cancel/", data={"job_id": job}, content_type="application/json",
                             HTTP_AUTHORIZATION=f"Bearer {self.tb}")
        self.assertEqual(c.status_code, 404)