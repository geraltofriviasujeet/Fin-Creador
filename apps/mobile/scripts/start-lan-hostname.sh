#!/bin/sh
# Starts Expo on the LAN under a hostname instead of a bare IP. Supabase refuses OAuth
# redirects to IP addresses, so Google sign-in in Expo Go needs this; sslip.io resolves
# 192-168-1-6.sslip.io back to 192.168.1.6 (no tunnel, traffic stays on the Wi-Fi).
# macOS only (uses ipconfig). Pass extra Expo flags through, e.g. --clear.
set -e
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
if [ -z "$IP" ]; then
  echo "Could not find this Mac's Wi-Fi IP address. Is Wi-Fi connected?" >&2
  exit 1
fi
HOST="$(echo "$IP" | tr . -).sslip.io"
echo "Expo will advertise $HOST (resolves to $IP)."
REACT_NATIVE_PACKAGER_HOSTNAME="$HOST" exec npx expo start "$@"
