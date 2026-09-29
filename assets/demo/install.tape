# 설치 과정 데모 녹화 대본 — 레포 루트에서 `vhs assets/demo/install.tape`
# 결과: assets/demo/install.gif, assets/demo/install.mp4

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

# 설치 / 업데이트 선택
Enter
Sleep 2.5s
# 감지된 타입(spring) 확인
Enter
Sleep 2.5s
# 서버 배포 방식: 단일 서버 배포
Enter
Sleep 2s
# 자동 버전 승격: 예
Enter
Sleep 1.5s
# Copilot AI 요약: 아니오 (기본)
Enter
Sleep 2.5s
# 분석 결과 확인 후 진행
Enter
Sleep 2s
# 브랜치 전략: pr-flow
Enter
Sleep 1.5s
# 릴리스 브랜치 main
Enter
Sleep 1s
# 개발 브랜치 develop
Enter
Sleep 3s
# 워크플로우 설정값: 기본값 그대로
Enter
Sleep 5s

Type "ls .github/workflows"
Enter
Sleep 4s
