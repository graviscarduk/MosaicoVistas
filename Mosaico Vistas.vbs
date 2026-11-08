' Mosaico Vistas - inicia o servico local sem janela de console.
' A pagina avisa que esta viva; quando a ultima aba fecha, o processo termina.

Option Explicit

Dim sh, fso, env, base, node, app, cmd

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

base = fso.GetParentFolderName(WScript.ScriptFullName)
node = fso.BuildPath(base, "node.exe")
app = fso.BuildPath(base, "app\server.mjs")

If Not fso.FileExists(node) Then
  MsgBox "node.exe nao encontrado." & vbCrLf & vbCrLf & _
         "Extraia o zip inteiro antes de abrir.", 16, "Mosaico Vistas"
  WScript.Quit 1
End If

If Not fso.FileExists(app) Then
  MsgBox "Pasta app nao encontrada." & vbCrLf & vbCrLf & _
         "Extraia o zip inteiro antes de abrir.", 16, "Mosaico Vistas"
  WScript.Quit 1
End If

sh.CurrentDirectory = base

Set env = sh.Environment("PROCESS")
env("MOSAICO_AUTOCLOSE") = "1"

cmd = """" & node & """ """ & app & """"
sh.Run cmd, 0, False
