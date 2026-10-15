; installer.nsh — pagina in piu' dell'installer (electron-builder, nsis.include).
;
; Il Live2D Cubism Core non puo' stare nell'installer (licenza proprietaria di
; Live2D). Questa pagina lo offre: con la casella spuntata, a fine
; installazione l'app parte con --install-live2d-core, scarica dal sito di
; Live2D lo zip ufficiale, ne tiene solo il Core controllato (SHA-256) e si
; chiude, senza finestre (main.js). Chi non la spunta lo fa dopo, da
; Impostazioni > Live2D.

!ifndef BUILD_UNINSTALLER
!include MUI2.nsh
!include nsDialogs.nsh
!include LogicLib.nsh

Var Live2DCheck
Var Live2DWanted

!macro customPageAfterChangeDir
  Page custom Live2DPageCreate Live2DPageLeave
!macroend

Function Live2DPageCreate
  !insertmacro MUI_HEADER_TEXT "Avatar Live2D" "Facoltativo: il Cubism Core per vedere gli avatar Live2D"
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateLabel} 0 0 100% 64u "CompanionAI include Hiyori, un avatar Live2D. Per mostrarlo serve il Live2D Cubism Core di Live2D Inc., che non si puo' includere nell'installer: si scarica dal sito ufficiale di Live2D (circa 19 MB) e se ne tiene solo il Core.$\r$\n$\r$\nSe non lo scarichi adesso, puoi farlo quando vuoi da Impostazioni > Live2D."
  Pop $0
  ${NSD_CreateLink} 0 70u 100% 12u "Leggi la Live2D Proprietary Software License"
  Pop $0
  ${NSD_OnClick} $0 Live2DOpenLicense
  ${NSD_CreateCheckbox} 0 90u 100% 24u "Accetto la licenza di Live2D e scarico il Cubism Core durante l'installazione"
  Pop $Live2DCheck
  ${If} $Live2DWanted == ${BST_CHECKED}
    ${NSD_Check} $Live2DCheck
  ${EndIf}
  nsDialogs::Show
FunctionEnd

Function Live2DOpenLicense
  ExecShell "open" "https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html"
FunctionEnd

Function Live2DPageLeave
  ${NSD_GetState} $Live2DCheck $Live2DWanted
FunctionEnd

!macro customInstall
  ${If} $Live2DWanted == ${BST_CHECKED}
    DetailPrint "Scarico il Live2D Cubism Core dal sito di Live2D..."
    ExecWait '"$INSTDIR\${PRODUCT_FILENAME}.exe" --install-live2d-core' $0
    ${If} $0 == 0
      DetailPrint "Cubism Core installato: Hiyori e gli altri avatar Live2D si vedono."
    ${Else}
      DetailPrint "Cubism Core non scaricato: si puo' fare da Impostazioni > Live2D."
    ${EndIf}
  ${EndIf}
!macroend
!endif
