#!/bin/bash
export EXPO_PUBLIC_API_URL="https://3000-${REPLIT_DEV_DOMAIN}/api"
echo "Starting Backend API on port 3000..."
PORT=3000 node server.js &
BACKEND_PID=$!

echo "Backend PID: $BACKEND_PID"
echo "Starting Expo web on port 5000 with API: $EXPO_PUBLIC_API_URL"
npx expo start --web --port 5000

wait $BACKEND_PID
