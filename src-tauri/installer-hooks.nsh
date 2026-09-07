; NSIS Installer Hooks for Voxify
; Prevents locked file errors during updates and clean uninstalls

!macro NSIS_HOOK_PREINSTALL
  ; Terminate running instances of Voxify so files can be written cleanly without locking errors
  nsExec::Exec 'taskkill /F /IM voxify.exe'
  Sleep 600
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; If VC++ runtime DLLs are present in resources\redist, copy them directly next to voxify.exe
  IfFileExists "$INSTDIR\resources\redist\vcruntime140.dll" 0 +3
    CopyFiles /SILENT "$INSTDIR\resources\redist\*.dll" "$INSTDIR"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Terminate running instances of Voxify before removing files
  nsExec::Exec 'taskkill /F /IM voxify.exe'
  Sleep 600
!macroend
