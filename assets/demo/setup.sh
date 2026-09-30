#!/usr/bin/env bash
# Creates a sample Spring project in a temp folder for the demo recording.
# Usage: source assets/demo/setup.sh  (run from the repo root)
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
# The recording shows npx, but it actually runs this repo's source (so unreleased versions can be recorded)
export PATH="$REPO_ROOT/assets/demo/bin:$PATH"
export PYTHONDONTWRITEBYTECODE=1
