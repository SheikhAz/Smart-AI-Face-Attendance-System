set e

echo "Starting Django Backend....."

cd /smart-face-attendance/backend

python manage.py runserver 0.0.0.0:8000 & 
BACKEND_PID=$!

echo "Starting React Frontend....."

cd /smart-face-attendance/frontend

npm run dev -- --host 0.0.0.0 &
FRONTEND_PID=$!

cleanup(){
    echo "Stopping Application servers...."
    kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

wait "$BACKEND_PID" "$FRONTEND_PID"