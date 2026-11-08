' Mosaico Vistas - encerra o servico local.
' Le o PID gravado pelo servidor e confere se o processo e mesmo o nosso
' antes de matar (PID pode ter sido reaproveitado por outro programa).

Option Explicit

Dim sh, fso, base, pid, file, arquivos, wmi, procs, p, achou

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

base = fso.GetParentFolderName(WScript.ScriptFullName)
pid = ""

arquivos = Array( _
  fso.BuildPath(base, "app\.mosaico.pid"), _
  fso.BuildPath(sh.ExpandEnvironmentStrings("%TEMP%"), "mosaico-cor.pid") _
)

For Each file In arquivos
  If fso.FileExists(file) Then
    pid = Trim(fso.OpenTextFile(file, 1).ReadAll())
    If pid <> "" Then Exit For
  End If
Next

If pid = "" Then
  MsgBox "O Mosaico nao esta rodando.", 64, "Mosaico Vistas"
  WScript.Quit 0
End If

Set wmi = GetObject("winmgmts:\\.\root\cimv2")
Set procs = wmi.ExecQuery("SELECT ProcessId, CommandLine FROM Win32_Process WHERE ProcessId=" & pid)

achou = False
For Each p In procs
  If InStr(1, p.CommandLine & "", "server.mjs", vbTextCompare) > 0 Then
    p.Terminate()
    achou = True
  End If
Next

If achou Then
  MsgBox "Mosaico encerrado.", 64, "Mosaico Vistas"
Else
  MsgBox "O Mosaico ja nao estava rodando.", 64, "Mosaico Vistas"
End If
