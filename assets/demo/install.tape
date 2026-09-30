# Install demo recording script — run `vhs assets/demo/install.tape` from the repo root
# Output: assets/demo/install.gif, assets/demo/install.mp4

Output assets/demo/install.gif
Output assets/demo/install.mp4

Set Shell "bash"
Set FontSize 16
Set Width 1200
Set Height 760
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 60ms
Set WindowBar Colorful

Hide
Type "source assets/demo/setup.sh && export PS1='\[\e[32m\]my-service\[\e[0m\] $ ' && clear"
Enter
Sleep 1s
Show

Type "npx project-auto-wizard"
Sleep 400ms
Enter
Sleep 2.5s

# Choose install / update
Enter
Sleep 2.5s
# Confirm the detected type (spring)
Enter
Sleep 2.5s
# Server deploy style: single server
Enter
Sleep 2s
# Automatic version bump: yes
Enter
Sleep 1.5s
# Copilot AI summaries: no (default)
Enter
Sleep 2.5s
# Review the analysis and continue
Enter
Sleep 2s
# Branch strategy: pr-flow
Enter
Sleep 1.5s
# Release branch: main
Enter
Sleep 1s
# Development branch: develop
Enter
Sleep 3s
# Workflow settings: keep the defaults
Enter
Sleep 5s

Type "ls .github/workflows"
Enter
Sleep 4s
