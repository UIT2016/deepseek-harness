' DSH 控制台 hidden starter: runs launcher.mjs with no console window.
' Double-clicking again while it runs just reopens the panel (see .instance).
Dim fso, shell, dir
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("Wscript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = dir
shell.Run "node """ & dir & "\launcher.mjs""", 0, False
