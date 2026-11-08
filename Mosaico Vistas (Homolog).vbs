' Mosaico Vistas - HOMOLOGACAO
' Inicia a versao de testes na porta 8788 (a estavel usa 8787),
' para as duas poderem rodar ao mesmo tempo.
' Sem janela de console. A pagina avisa que esta viva; quando a ultima
' aba fecha, o processo termina.

Option Explicit

Dim sh, fso, env, base, node, app, cmd, candidatos, c

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

base = fso.GetParentFolderName(WScript.ScriptFullName)
app = fso.BuildPath(base, "app\server.mjs")

If Not fso.FileExists(app) Then
  MsgBox "Pasta app nao encontrada." & vbCrLf & vbCrLf & _
         "Extraia o zip inteiro antes de abrir.", 16, "Mosaico Vistas - Homolog"
  WScript.Quit 1
End If

' 1) node.exe do pacote portatil  2) Node.js instalado no Windows
node = fso.BuildPath(base, "node.exe")
If Not fso.FileExists(node) Then
  node = ""
  candidatos = Array( _
    sh.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\node.exe"), _
    sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%\nodejs\node.exe"), _
    sh.ExpandEnvironmentStrings("%LOCALAPPDATA%\Programs\nodejs\node.exe") _
  )
  For Each c In candidatos
    If node = "" Then
      If fso.FileExists(c) Then node = c
    End If
  Next
End If

If node = "" Then
  MsgBox "node.exe nao encontrado." & vbCrLf & vbCrLf & _
         "Esta e a pasta de HOMOLOGACAO (desenvolvimento)." & vbCrLf & _
         "Instale o Node.js ou rode o build para gerar o pacote portatil.", 16, "Mosaico Vistas - Homolog"
  WScript.Quit 1
End If

sh.CurrentDirectory = base

Set env = sh.Environment("PROCESS")
env("MOSAICO_AUTOCLOSE") = "1"
env("PORT") = "8788"

cmd = """" & node & """ """ & app & """"
sh.Run cmd, 0, False
