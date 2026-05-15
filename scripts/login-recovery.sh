#!/bin/bash
# Login Recovery Script
# 在 OAuth allowlist 改不了的情況下，用 password grant 換 token，寫 session.json
# 給 Tauri app 用，跳過 Google OAuth flow

set -e

echo "════════════════════════════════════════════"
echo "  慈濟海報後台 — Login Recovery"
echo "════════════════════════════════════════════"
echo ""

# 1. 收集三個值
read -p "Supabase URL (e.g. https://supabase.example.com): " SUPA_URL
read -p "Anon key (eyJ... 那一長串): " SUPA_KEY
read -sp "你剛才在 SQL Editor 設的臨時密碼: " PASSWORD
echo ""
echo ""

# 2. 寫死你的 email
EMAIL="cmn932216@tzuchi.org.tw"

echo "→ 嘗試以 password grant 換 token..."
RESP=$(curl -s -X POST "${SUPA_URL%/}/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPA_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")

# 3. 檢查回傳
if echo "$RESP" | grep -q "access_token"; then
  echo "✅ Token 取得成功"
else
  echo "❌ 失敗。Supabase 回傳："
  echo "$RESP"
  echo ""
  echo "常見原因："
  echo "  - error_description: invalid_grant → 密碼錯，或這個 user 還沒設密碼"
  echo "  - msg: Email logins are disabled → GoTrue 把 password grant 關了"
  echo "  - 404 / Could not resolve → URL 寫錯"
  exit 1
fi

# 4. 用 python 解析 + 寫 session.json
SESSION_PATH="$HOME/Library/Application Support/org.tzuchi.poster-admin/session.json"
mkdir -p "$(dirname "$SESSION_PATH")"

echo "$RESP" | /usr/bin/python3 -c "
import json, sys, os
r = json.load(sys.stdin)
u = r.get('user', {})
meta = u.get('user_metadata', {})
session = {
    'user': {
        'id': u['id'],
        'email': u['email'],
        'name': meta.get('full_name') or meta.get('name') or u['email'],
        'role': 'creator',  # role 是 email-domain-derived，不影響 app_role check
        'avatar_url': meta.get('avatar_url') or meta.get('picture'),
    },
    'access_token': r['access_token'],
    'refresh_token': r['refresh_token'],
}
path = os.environ['SESSION_PATH']
with open(path, 'w') as f:
    json.dump(session, f, indent=2, ensure_ascii=False)
print(f'✅ Wrote {path}')
print(f'   user: {session[\"user\"][\"email\"]} ({session[\"user\"][\"name\"]})')
print(f'   access_token: {session[\"access_token\"][:30]}...')
print(f'   refresh_token: {session[\"refresh_token\"][:20]}...')
" SESSION_PATH="$SESSION_PATH"

echo ""
echo "════════════════════════════════════════════"
echo "  下一步：重啟 Tauri"
echo "════════════════════════════════════════════"
echo ""
echo "  # kill 現在的 dev process"
echo "  kill 5137  # 或 pkill -f 'tauri dev'"
echo ""
echo "  # 重新啟動"
echo "  cd /Users/webit/Desktop/p1/posterbackend"
echo "  npm run tauri dev"
echo ""
echo "啟動 log 看到 [Auth] restored persisted session for cmn932216@tzuchi.org.tw"
echo "就是還原成功，不用再走 Google 登入。"
