#!/bin/bash
export EXPO_PUBLIC_API_URL="https://3000-${REPLIT_DEV_DOMAIN}/api"
echo "Starting Expo web with API URL: $EXPO_PUBLIC_API_URL"
npx expo start --web --port 5000
