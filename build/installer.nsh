!include "MUI2.nsh"
!include "FileFunc.nsh"

; ============================================================
; Silhouette Agency OS — Custom NSIS Installer Script
; ============================================================

; Branding - variables injected automatically by electron-builder
; !define PRODUCT_NAME "Silhouette Agency OS" (Auto-injected)
!define PRODUCT_DESCRIPTION "AI-Powered Autonomous Agency Operating System"

; All visual customizations and pages are handled automatically by electron-builder

; ============================================================
; Custom Macros
; ============================================================

; Check minimum system requirements
!macro customInit
  ; Handled by electron-builder
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
