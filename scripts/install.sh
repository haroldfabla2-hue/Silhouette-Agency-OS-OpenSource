#!/bin/bash

# SILHOUETTE AGENCY OS - UNIVERSAL INSTALLER (BASH)
# ===============================================

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${PURPLE}🌑 SILHOUETTE AGENCY OS - UNIVERSAL INSTALLER${NC}"
echo -e "${PURPLE}==============================================${NC}\n"

# 1. Check Dependencies
echo -e "${BLUE}🔍 Checking dependencies...${NC}"

check_cmd() {
    if ! command -v "$1" &> /dev/null; then
        return 1
    fi
    return 0
}

if ! check_cmd node; then echo -e "${RED}❌ Node.js is not installed.${NC}"; exit 1; fi
if ! check_cmd npm; then echo -e "${RED}❌ npm is not installed.${NC}"; exit 1; fi
if ! check_cmd git; then echo -e "${RED}❌ Git is not installed.${NC}"; exit 1; fi

echo -e "${GREEN}✅ All core dependencies found.${NC}"

# 2. Setup
echo -e "\n${BLUE}📦 Installing project dependencies...${NC}"
npm install

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ npm install failed.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Dependencies installed successfully.${NC}"

# 3. Launch Bootstrap Wizard
echo -e "\n${BLUE}⚙️  Starting Setup Wizard...${NC}"
npm run setup:v2

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Setup Wizard encountered an error.${NC}"
    exit 1
fi

echo -e "\n${PURPLE}==============================================${NC}"
echo -e "${GREEN}🎉 INSTALLATION COMPLETE${NC}"
echo -e "${PURPLE}==============================================${NC}"
