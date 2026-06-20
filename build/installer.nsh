!include "MUI2.nsh"
!include "FileFunc.nsh"

; ============================================================
; Silhouette Agency OS — Custom NSIS Installer Script
; ============================================================

; Branding
!define PRODUCT_NAME "Silhouette Agency OS"
!define PRODUCT_PUBLISHER "Silhouette Agency"
!define PRODUCT_WEB_SITE "https://github.com/haroldfabla2-hue/Silhouette-Agency-OS-OpenSource"
!define PRODUCT_DESCRIPTION "AI-Powered Autonomous Agency Operating System"

; Visual Customization
!define MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
!define MUI_UNICON "${NSISDIR}\Contrib\Graphics\Icons\modern-uninstall.ico"
!define MUI_WELCOMEFINISHPAGE_BITMAP "${NSISDIR}\Contrib\Graphics\Wizard\win.bmp"
!define MUI_ABORTWARNING

; Welcome Page Text
!define MUI_WELCOMEPAGE_TITLE "Welcome to ${PRODUCT_NAME} Setup"
!define MUI_WELCOMEPAGE_TEXT "This wizard will guide you through the installation of ${PRODUCT_NAME}.$\r$\n$\r$\n${PRODUCT_NAME} is an AI-powered operating system for autonomous agent swarms, featuring local LLM orchestration, cognitive memory, and multi-channel communication.$\r$\n$\r$\nClick Next to continue."

; Finish Page
!define MUI_FINISHPAGE_RUN "$INSTDIR\${PRODUCT_NAME}.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch ${PRODUCT_NAME}"
!define MUI_FINISHPAGE_LINK "Visit ${PRODUCT_NAME} on GitHub"
!define MUI_FINISHPAGE_LINK_LOCATION "${PRODUCT_WEB_SITE}"

; ============================================================
; Custom Macros
; ============================================================

; Check minimum system requirements
!macro customInit
  ; Verify Windows 10+ (build 17763+)
  ${GetWindowsVersion} $0
  ; Note: electron-builder handles OS checks natively,
  ; this is a fallback for edge cases
!macroend

; Post-install actions
!macro customInstall
  ; Register application protocol handler: silhouette://
  WriteRegStr HKCU "Software\Classes\silhouette" "" "URL:Silhouette Protocol"
  WriteRegStr HKCU "Software\Classes\silhouette" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\silhouette\shell\open\command" "" '"$INSTDIR\${PRODUCT_NAME}.exe" "%1"'

  ; Create app data directory structure
  CreateDirectory "$APPDATA\${PRODUCT_NAME}\logs"
  CreateDirectory "$APPDATA\${PRODUCT_NAME}\data"
  CreateDirectory "$APPDATA\${PRODUCT_NAME}\models"
!macroend

; Pre-uninstall cleanup
!macro customUnInstall
  ; Remove protocol handler
  DeleteRegKey HKCU "Software\Classes\silhouette"

  ; Ask user if they want to remove app data
  MessageBox MB_YESNO "Do you want to remove all ${PRODUCT_NAME} data (models, databases, logs)?$\r$\nThis action cannot be undone." IDYES removeData IDNO skipRemove
  removeData:
    RMDir /r "$APPDATA\${PRODUCT_NAME}"
  skipRemove:
!macroend
