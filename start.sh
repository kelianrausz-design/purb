#!/bin/bash
GREEN='\033[0;32m'
CYAN='\033[0;36m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo -e "${CYAN}⚡ PurB — Plug Your Beats${NC}"
echo ""

if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo -e "${RED}❌ ANTHROPIC_API_KEY manquante !${NC}"
  echo -e "${YELLOW}  ANTHROPIC_API_KEY=ta-cle ./start.sh${NC}"
  exit 1
fi

if ! command -v node &> /dev/null; then
  echo -e "${RED}❌ Node.js non trouvé !${NC}"
  exit 1
fi

NODE_V=$(node -v | cut -d. -f1 | tr -d 'v')
if [ "$NODE_V" -lt 18 ]; then
  echo -e "${RED}❌ Node.js trop vieux ($(node -v)). Il faut Node 18+${NC}"
  echo -e "${YELLOW}  source ~/.nvm/nvm.sh && nvm use 20${NC}"
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo -e "${YELLOW}📦 Installation des dépendances...${NC}"
  npm install
fi

pkill -f "node server.js" 2>/dev/null

echo -e "${GREEN}🟢 Proxy (port 3001)...${NC}"
node server.js &
PROXY_PID=$!
sleep 1

echo -e "${GREEN}🟢 Vite (port 5173)...${NC}"
echo ""
echo -e "${CYAN}════════════════════════════════════════${NC}"
echo -e "${CYAN}  ⚡ PurB est prêt !${NC}"
echo -e "${CYAN}  ${GREEN}http://localhost:5173${NC}"
echo -e "${CYAN}════════════════════════════════════════${NC}"
echo ""

npx vite --host

kill $PROXY_PID 2>/dev/null
