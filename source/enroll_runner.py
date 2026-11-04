"""
Non-interactive entry point for add_face.py. Launched by the Django backend:
    python enroll_runner.py <unique_id>
Needs env vars: ATTENDANCE_BASE_URL, INTERNAL_API_KEY, COMPANY_ID (set by the backend).
"""
import builtins
import sys

import add_face


def main():
    if len(sys.argv) != 2:
        print("ERROR usage: enroll_runner.py <unique_id>")
        return 2
    uid = sys.argv[1]

    users = add_face.load_users(use_cache=False)
    if uid not in {u.get("unique_id") for u in users}:
        print("ERROR staff member not found in this company")
        return 2

    add_face.select_user = lambda _users: uid  # skip the numbered menu

    def auto_input(prompt=""):
        if "anyway" in prompt:      # duplicate face: never enroll unattended
            return "n"
        return ""                   # "Press ENTER when ready" etc.

    builtins.input = auto_input
    add_face.enroll()
    return 0


if __name__ == "__main__":
    sys.exit(main())