#!/usr/bin/env bash
# 데모 녹화용 예시 Spring 프로젝트를 임시 폴더에 만든다.
# 사용: source assets/demo/setup.sh  (레포 루트에서 실행)
set -e
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEMO_DIR="$(mktemp -d)/my-service"
mkdir -p "$DEMO_DIR/src/main/resources"
cd "$DEMO_DIR"
git init -q -b main
cat > build.gradle <<'GRADLE'
plugins {
    id 'java'
    id 'org.springframework.boot' version '3.5.6'
}

group = 'com.example'
version = '0.1.0'
GRADLE
echo "spring.application.name=my-service" > src/main/resources/application.properties
echo "# my-service" > README.md
git add -A && git -c user.name=demo -c user.email=demo@example.com commit -qm init
# 녹화 화면에는 npx로 보이지만 실제로는 이 저장소의 소스를 실행한다 (배포 전 버전도 녹화 가능)
export PATH="$REPO_ROOT/assets/demo/bin:$PATH"
export PYTHONDONTWRITEBYTECODE=1
