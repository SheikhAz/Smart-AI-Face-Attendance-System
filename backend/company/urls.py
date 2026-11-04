from django.urls import path
from . import views , enroll ,enroll_frame ,recognize_frame

urlpatterns = [
    path("staff-login/", views.staff_login),
    path("staff-me/", views.staff_me),
    path("start-enroll/", enroll.start_enroll),
    path("enroll-frame/", enroll_frame.enroll_frame),
    path("enroll-status/", enroll.enroll_status),
    path("enroll-cancel/", enroll.enroll_cancel),
    path("get-users/", views.get_users),
    path("save-embeddings-batch/", views.save_embeddings_batch),
    path("recognize-frame/", recognize_frame.recognize_frame),
]