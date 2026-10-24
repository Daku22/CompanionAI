; installer.nsh — pagina in piu' dell'installer (electron-builder, nsis.include).
;
; Il Live2D Cubism Core non puo' stare nell'installer (licenza proprietaria di
; Live2D). Questa pagina lo offre: con la casella spuntata, a fine
; installazione l'app parte con --install-live2d-core, scarica dal sito di
; Live2D lo zip ufficiale, ne tiene solo il Core controllato (SHA-256) e si
; chiude, senza finestre (main.js). Chi non la spunta lo fa dopo, da
; Impostazioni > Live2D.
;
; La pagina "Componenti facoltativi" offre la voce realistica (XTTS), il
; microfono e Kimodo: sono gigabyte, quindi non stanno nell'installer. Con le
; caselle spuntate, a fine installazione l'app parte con
; --install-components=..., apre una finestra con l'avanzamento, scarica e
; installa come dalle Impostazioni (versioni fisse e SHA-256) e si chiude;
; l'installer aspetta. Spuntare una casella vuol dire accettare la licenza di
; quel componente.

!ifndef BUILD_UNINSTALLER
!include MUI2.nsh
!include nsDialogs.nsh
!include LogicLib.nsh

Var Live2DCheck
Var Live2DWanted
Var XttsCheck
Var SttCheck
Var KimodoCheck
Var XttsWanted
Var SttWanted
Var KimodoWanted

!macro customPageAfterChangeDir
  Page custom Live2DPageCreate Live2DPageLeave
  Page custom ComponentsPageCreate ComponentsPageLeave
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

Function ComponentsPageCreate
  !insertmacro MUI_HEADER_TEXT "Componenti facoltativi" "Voce realistica, microfono e movimenti nuovi: si scaricano a fine installazione"
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateLabel} 0 0 100% 30u "Sono grandi e servono una scheda video: si scaricano a fine installazione, con una finestra che mostra l'avanzamento (da qualche minuto a un'ora, secondo la connessione). Puoi aggiungerli anche dopo, dalle Impostazioni. Spuntando una casella accetti la licenza di quel componente."
  Pop $0
  ${NSD_CreateCheckbox} 0 36u 100% 20u "Voce realistica XTTS (circa 5 GB, solo schede NVIDIA): accetto la licenza CPML, solo uso non commerciale"
  Pop $XttsCheck
  ${NSD_OnClick} $XttsCheck ComponentsXttsClick
  ${NSD_CreateLink} 12u 56u 90% 10u "Leggi la Coqui Public Model License"
  Pop $0
  ${NSD_OnClick} $0 ComponentsOpenCpml
  ${NSD_CreateCheckbox} 0 70u 100% 20u "Microfono, per parlargli a voce (circa 1,8 GB, usa la voce XTTS: la spunta anche)"
  Pop $SttCheck
  ${NSD_OnClick} $SttCheck ComponentsSttClick
  ${NSD_CreateCheckbox} 0 94u 100% 20u "Movimenti nuovi con Kimodo (circa 5,5 GB, scheda video con 3 GB liberi): accetto le licenze dei modelli"
  Pop $KimodoCheck
  ${NSD_CreateLink} 12u 114u 45% 10u "NVIDIA Open Model License"
  Pop $0
  ${NSD_OnClick} $0 ComponentsOpenNvidia
  ${NSD_CreateLink} 50% 114u 48% 10u "Meta Llama 3 Community License"
  Pop $0
  ${NSD_OnClick} $0 ComponentsOpenLlama
  ${If} $XttsWanted == ${BST_CHECKED}
    ${NSD_Check} $XttsCheck
  ${EndIf}
  ${If} $SttWanted == ${BST_CHECKED}
    ${NSD_Check} $SttCheck
  ${EndIf}
  ${If} $KimodoWanted == ${BST_CHECKED}
    ${NSD_Check} $KimodoCheck
  ${EndIf}
  nsDialogs::Show
FunctionEnd

; Il microfono usa il Python di XTTS: spuntarlo spunta la voce, toglierla toglie il microfono.
Function ComponentsSttClick
  ${NSD_GetState} $SttCheck $0
  ${If} $0 == ${BST_CHECKED}
    ${NSD_Check} $XttsCheck
  ${EndIf}
FunctionEnd

Function ComponentsXttsClick
  ${NSD_GetState} $XttsCheck $0
  ${If} $0 != ${BST_CHECKED}
    ${NSD_Uncheck} $SttCheck
  ${EndIf}
FunctionEnd

Function ComponentsOpenCpml
  ExecShell "open" "https://huggingface.co/coqui/XTTS-v2/blob/6c2b0d75eae4b7047358e3b6bd9325f857d43f77/LICENSE.txt"
FunctionEnd

Function ComponentsOpenNvidia
  ExecShell "open" "https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/"
FunctionEnd

Function ComponentsOpenLlama
  ExecShell "open" "https://www.llama.com/llama3/license/"
FunctionEnd

Function ComponentsPageLeave
  ${NSD_GetState} $XttsCheck $XttsWanted
  ${NSD_GetState} $SttCheck $SttWanted
  ${NSD_GetState} $KimodoCheck $KimodoWanted
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
  StrCpy $1 ""
  ${If} $XttsWanted == ${BST_CHECKED}
    StrCpy $1 "$1xtts,"
  ${EndIf}
  ${If} $SttWanted == ${BST_CHECKED}
    StrCpy $1 "$1stt,"
  ${EndIf}
  ${If} $KimodoWanted == ${BST_CHECKED}
    StrCpy $1 "$1kimodo,"
  ${EndIf}
  ${If} $1 != ""
    DetailPrint "Scarico i componenti scelti: una finestra mostra l'avanzamento..."
    ExecWait '"$INSTDIR\${PRODUCT_FILENAME}.exe" --install-components=$1' $0
    ${If} $0 == 0
      DetailPrint "Componenti installati."
    ${Else}
      DetailPrint "Non tutti i componenti sono stati installati: si possono aggiungere dalle Impostazioni."
    ${EndIf}
  ${EndIf}
!macroend
!endif
