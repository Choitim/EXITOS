# VHS script for the ExitOS offline demo. Render with:  vhs docs/demo.tape
# (Install VHS separately: https://github.com/charmbracelet/vhs — it is not a repo dependency.)
Output docs/assets/demo.gif

Set Shell "bash"
Set FontSize 18
Set Width 1500
Set Height 900
Set Theme "Catppuccin Mocha"
Set TypingSpeed 60ms
Set Padding 24

Type "pnpm exitos demo --pace 900"
Sleep 600ms
Enter

# Banner + inspect + the plan summary (MOVES / CHANGES / CANNOT MOVE)
Sleep 9s
# Apply with injected rate limits and a lost reply
Sleep 6s
# Verify + the NOT PRESERVED report
Sleep 8s

Type "pnpm exitos ui --demo"
Enter
Sleep 4s
