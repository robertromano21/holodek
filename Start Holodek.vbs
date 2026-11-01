Option Explicit
Dim shell, files, root, command, result
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root
command = "node.exe " & Chr(34) & root & "\tools\runtime\start-game.cjs" & Chr(34)
result = shell.Run(command, 0, True)
If result <> 0 Then
    MsgBox "Holodek could not start safely. No unrelated application was stopped." & vbCrLf & _
        "Details: " & root & "\.retort-data\startup-error.log", vbExclamation, "Holodek"
End If
