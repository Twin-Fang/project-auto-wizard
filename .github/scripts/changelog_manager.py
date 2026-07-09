#!/usr/bin/env python3
"""
changelog_manager.py

통합 체인지로그 매니저 스크립트.

서브커맨드:
  - update-from-summary: CodeRabbit Summary Markdown을 파싱하여 CHANGELOG.json 갱신
  - generate-md        : CHANGELOG.json을 기반으로 CHANGELOG.md 재생성
  - export             : 특정 버전의 릴리즈 노트를 생성하여 stdout 또는 파일로 저장
  - ai-summary         : 커밋 목록으로부터 AI(또는 규칙 기반 폴백) 릴리즈 요약 생성

사용 예:
  python3 changelog_manager.py update-from-summary
  python3 changelog_manager.py generate-md
  python3 changelog_manager.py export --version 0.0.2 --output release_notes.txt
  python3 changelog_manager.py ai-summary --commits-file commits.txt --version 1.2.3 --output summary.md

입력 파일:
  - pr_body.md: GitHub PR body (Markdown 형식)
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
import traceback
import urllib.error
import urllib.request


# ----------------------------- 공통 유틸 -----------------------------

def _normalize_text(text: str) -> str:
    """텍스트 정규화: HTML 엔티티 디코딩 및 공백 정리."""
    return html.unescape(text).strip()


def _clean_summary_noise(text: str) -> str:
    """
    Summary 텍스트에서 불필요한 노이즈 제거.

    제거 대상:
    1. HTML 주석 (<!-- ... -->)
    2. CodeRabbit Tip 메시지
    3. 남은 HTML 태그
    4. 연속된 빈 줄
    """
    if not text:
        return text

    # 1. HTML 주석 제거
    text = re.sub(r'<!--.*?-->', '', text, flags=re.DOTALL)

    # 2. CodeRabbit Tip 줄 제거
    text = re.sub(r'^.*?✏️\s*Tip:.*$', '', text, flags=re.MULTILINE)
    text = re.sub(r'<sub>.*?Tip:.*?</sub>', '', text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r'^\s*Tip:.*$', '', text, flags=re.MULTILINE | re.IGNORECASE)

    # 3. 남은 HTML 태그 제거
    text = re.sub(r'<[^>]+>', '', text)

    # 4. 연속된 빈 줄 정리 (3개 이상 → 2개)
    text = re.sub(r'\n{3,}', '\n\n', text)

    return text.strip()


def _make_safe_key(title: str, idx: int) -> str:
    """카테고리 제목을 안전한 키로 변환."""
    safe_key = re.sub(r'[^a-zA-Z0-9가-힣]', '_', title.lower()).strip('_')
    return safe_key if safe_key else f"category_{idx}"


# ----------------------- Markdown 파서 (통합) -----------------------

def _parse_summary_markdown(md_content: str) -> dict:
    """
    Markdown 형식의 CodeRabbit Summary 파싱.

    3단계 폴백 전략:
    1. 정밀 파싱 (현재 CodeRabbit 형식)
    2. 관대한 파싱 (형식 변형 대응)
    3. 휴리스틱 파싱 (최후 수단)

    예상 형식:
    ## Summary by CodeRabbit

    * **버그 수정**
      * OCR 입력 처리 개선
      * 빈 콘텐츠 응답 오류 감지 강화

    * **Chores**
      * 버전 0.1.39로 업그레이드
    """
    # 1단계: 정밀 파싱
    detected = _parse_markdown_precise(md_content)
    if detected:
        print("  → 정밀 파서 성공")
        return detected

    # 2단계: 관대한 파싱
    detected = _parse_markdown_lenient(md_content)
    if detected:
        print("  → 관대한 파서 성공")
        return detected

    # 3단계: 휴리스틱 파싱
    detected = _parse_markdown_heuristic(md_content)
    if detected:
        print("  → 휴리스틱 파서 성공")
    return detected


def _parse_markdown_precise(md_content: str) -> dict:
    """
    정밀 파서: 현재 CodeRabbit 형식에 최적화.

    형식: * **카테고리**\n  * 항목
    """
    detected: dict[str, dict] = {}

    # 패턴: * **카테고리** (bold, 들여쓰기 2칸)
    pattern = r'\*\s*\*\*(.+?)\*\*\s*\n((?:\s{2}\*\s+.+(?:\n|$))*)'
    matches = re.findall(pattern, md_content, re.MULTILINE)

    for idx, (category_title, items_text) in enumerate(matches):
        category_title = category_title.strip()

        # 항목 추출: "  * 항목 내용"
        items = re.findall(r'\s{2}\*\s+(.+)', items_text)
        items = [item.strip() for item in items if item.strip()]

        if not category_title and not items:
            continue

        safe_key = _make_safe_key(category_title, idx)
        detected[safe_key] = {
            'title': category_title,
            'items': items,
        }

    return detected


def _parse_markdown_lenient(md_content: str) -> dict:
    """
    관대한 파서: 형식 변형에 대응.

    지원:
    - 들여쓰기 1~8칸 (탭 포함)
    - bold 선택적 (**제목** 또는 제목)
    - 다양한 리스트 마커 (*, -, +)
    """
    content = md_content.replace('\t', '    ')
    detected: dict[str, dict] = {}

    # 패턴: 카테고리 + 중첩 항목
    pattern = r'(?:^|\n)([\*\-\+])\s*(\*\*)?([^\*\n]+?)(\*\*)?\s*\n((?:(?:^|\n)\s{1,8}[\*\-\+]\s+.+)*)'
    matches = re.findall(pattern, content, re.MULTILINE)

    for idx, (marker, bold_start, category_title, bold_end, items_text) in enumerate(matches):
        category_title = category_title.strip()

        # 항목 추출
        items = re.findall(r'(?:^|\n)\s{1,8}[\*\-\+]\s+(.+)', items_text, re.MULTILINE)
        items = [item.strip() for item in items if item.strip()]

        if not category_title and not items:
            continue

        # 너무 긴 제목은 카테고리가 아님
        if len(category_title) > 100:
            continue

        safe_key = _make_safe_key(category_title, idx)
        detected[safe_key] = {
            'title': category_title,
            'items': items,
        }

    return detected


def _parse_markdown_heuristic(md_content: str) -> dict:
    """
    휴리스틱 파서: 줄 단위로 카테고리/항목 추론.

    규칙:
    1. Bold 텍스트(**...**) → 카테고리
    2. 들여쓰기 있는 줄 → 항목
    """
    lines = md_content.split('\n')
    detected: dict[str, dict] = {}
    current_key = None

    for line in lines:
        stripped = line.strip()

        if not stripped or stripped.startswith('<!--') or stripped.startswith('##'):
            continue

        # Bold 텍스트 → 카테고리
        bold_match = re.search(r'\*\*([^\*]+)\*\*', stripped)
        if bold_match:
            title = bold_match.group(1).strip()
            title = re.sub(r'^[\*\-\+\d\.]+\s*', '', title).strip()

            if title and len(title) < 100:
                current_key = _make_safe_key(title, len(detected))
                detected[current_key] = {'title': title, 'items': []}
            continue

        # 들여쓰기 있는 줄 → 항목
        if line.startswith((' ', '\t')) and stripped:
            item = re.sub(r'^[\*\-\+\d\.]+\s*', '', stripped).strip()
            item = re.sub(r'<[^>]+>', '', item).strip()

            if current_key and item and len(item) > 3:
                detected[current_key]['items'].append(item)

    # 빈 카테고리 제거
    return {k: v for k, v in detected.items() if v.get('items')}


# ------------------------ 3단계 규칙 기반 폴백 파서 ------------------------

# 1단계 패턴은 제목도 같은 정규식에서 캡처한다 — " : type : " 마커(타입 앞 콜론에
# 반드시 공백 선행)가 유일한 구분자이므로, 제목 안의 맨몸 콜론("v1:2" 등)에서
# 잘리지 않는다. 별도 split 재수행 금지.
_TIER1_RE = re.compile(r'^(.+?)\s:\s*(feat|fix|chore|docs|refactor|test)\s*:\s*(.+)$')
_TRAILING_URL_RE = re.compile(r'\s*https?://\S+$')
_TIER2_RE = re.compile(
    r'^(feat|fix|chore|docs|refactor|test|perf|style|build|ci)(\([^)]*\))?!?:\s*(.+)$'
)
_TIER2_BUCKET_MAP = {
    'feat': 'feat',
    'fix': 'fix',
    'chore': 'chore',
    'docs': 'docs',
    'refactor': 'refactor',
    'test': 'test',
    'perf': 'chore',
    'style': 'chore',
    'build': 'chore',
    'ci': 'chore',
}

_FALLBACK_BUCKET_KEYS = ('feat', 'fix', 'chore', 'docs', 'refactor', 'test', 'changes')


def classify_commits(lines: list[str]) -> dict:
    """
    커밋 제목 목록을 3단계 규칙으로 분류.

    1단계: projectops 컨벤션 — "제목 : type : 내용 [URL]"
    2단계: Conventional Commits — "type(scope)!: 내용"
           (perf/style/build/ci → chore 버킷으로 매핑)
    3단계: 위 두 형식에 매칭되지 않으면 "changes" 버킷 (자유 형식)

    제외 대상 (매칭 전에 걸러냄): [skip ci] 포함 줄, "Merge "로 시작하는 줄, 빈 줄.
    """
    classified: dict[str, list[str]] = {key: [] for key in _FALLBACK_BUCKET_KEYS}

    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            continue
        if '[skip ci]' in line:
            continue
        if line.startswith('Merge '):
            continue

        # 1단계가 2단계보다 먼저다 — 트레이드오프: "제목 : feat : 내용" 형식은
        # "feat: ..." Conventional Commits와 겹칠 수 없지만(타입 앞에 제목 필수),
        # 제목이 있는 줄에 " : type : "가 우연히 들어가면 tier-2 해석 기회 없이
        # tier-1로 확정된다. projectops 컨벤션 레포에서는 이것이 의도된 우선순위다.
        tier1 = _TIER1_RE.match(line)
        if tier1:
            title = tier1.group(1).strip()
            commit_type = tier1.group(2)
            desc = tier1.group(3).strip()
            # 커밋 말미의 이슈 URL은 릴리즈 노트 렌더링에서 노이즈 — 제거.
            desc = _TRAILING_URL_RE.sub('', desc).strip()
            classified[commit_type].append(f"{title} — {desc}")
            continue

        tier2 = _TIER2_RE.match(line)
        if tier2:
            commit_type, _scope, desc = tier2.group(1), tier2.group(2), tier2.group(3)
            bucket = _TIER2_BUCKET_MAP[commit_type]
            classified[bucket].append(desc.strip())
            continue

        classified['changes'].append(line)

    return classified


_FALLBACK_SECTION_TITLES = {
    'feat': '### ✨ 기능',
    'fix': '### 🐛 수정',
    'docs': '### 📝 문서',
    'refactor': '### ♻️ 리팩토링',
    'test': '### ✅ 테스트',
}


def render_fallback_md(classified: dict, version: str) -> str:
    """분류된 커밋 딕셔너리를 마크다운 릴리즈 노트로 렌더링."""
    lines: list[str] = [f"## [{version}]", ""]

    for bucket_key in ('feat', 'fix', 'docs', 'refactor', 'test'):
        items = classified.get(bucket_key) or []
        if not items:
            continue
        lines.append(_FALLBACK_SECTION_TITLES[bucket_key])
        for item in items:
            lines.append(f"- {item}")
        lines.append("")

    chore_items = list(classified.get('chore') or [])
    changes_items = list(classified.get('changes') or [])
    merged = chore_items + changes_items
    if merged:
        lines.append("### 🔧 변경사항")
        for item in merged:
            lines.append(f"- {item}")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


# ------------------------ 서브커맨드 구현부 ------------------------

def cmd_update_from_summary() -> int:
    """pr_body.md에서 Markdown을 파싱하여 CHANGELOG.json 갱신."""
    version = os.environ.get('VERSION')
    project_type = os.environ.get('PROJECT_TYPE')
    # 멀티타입 — PROJECT_TYPES(csv) env가 있으면 배열로, 없으면 단수 키 fallback
    project_types_csv = os.environ.get('PROJECT_TYPES', '')
    project_types = [t.strip() for t in project_types_csv.split(',') if t.strip()]
    if not project_types and project_type:
        project_types = [project_type]
    today = os.environ.get('TODAY')
    pr_number_raw = os.environ.get('PR_NUMBER')
    timestamp = os.environ.get('TIMESTAMP')

    try:
        pr_number = int(pr_number_raw) if pr_number_raw else None
    except ValueError:
        pr_number = None

    # 입력 파일 찾기 (pr_body.md 우선, 폴백으로 summary_section.html)
    input_file = None
    for filename in ['pr_body.md', 'summary_section.html']:
        if os.path.isfile(filename):
            input_file = filename
            break

    if not input_file:
        print("❌ 입력 파일을 찾을 수 없습니다 (pr_body.md 또는 summary_section.html)")
        return 1

    try:
        with open(input_file, 'r', encoding='utf-8') as f:
            content = f.read()

        print(f"📄 입력 파일: {input_file}")
        print(f"📝 파일 크기: {len(content)} bytes")

        # Markdown 파싱 (통합)
        print("\n🔍 Markdown 파싱 시작...")
        categories = _parse_summary_markdown(content)

        parse_method = 'markdown' if categories else 'markdown_failed'
        if categories:
            print(f"✅ 파싱 성공: {len(categories)}개 카테고리")
        else:
            print("⚠️ 파싱 실패, raw_summary만 저장")

        # raw_summary 생성 (노이즈 제거)
        raw_summary = _clean_summary_noise(content)

        # 릴리즈 데이터 생성
        new_release = {
            "version": version,
            "project_type": project_type,      # 기존 단수 키 — 유지 (하위 호환)
            "project_types": project_types,    # 신규 멀티타입 배열
            "date": today,
            "pr_number": pr_number,
            "raw_summary": raw_summary,
            "parsed_changes": categories or {},
            "parse_method": parse_method,
        }

        # 파싱 결과 출력
        print("\n📊 파싱 결과:")
        print(f"  - 파싱 방식: {parse_method}")
        print(f"  - raw_summary 길이: {len(raw_summary)} 문자")
        print(f"  - 파싱된 카테고리: {len(categories)}개")
        for key, value in categories.items():
            title = value.get('title', key)
            items_count = len(value.get('items', []))
            print(f"    • {title}: {items_count}개 항목")

        # CHANGELOG.json 업데이트
        try:
            with open('CHANGELOG.json', 'r', encoding='utf-8') as f:
                changelog_data = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            changelog_data = {
                "metadata": {
                    "lastUpdated": timestamp,
                    "currentVersion": version,
                    "projectType": project_type,
                    "projectTypes": project_types,
                    "totalReleases": 0,
                },
                "releases": [],
            }

        # 방어: 파일이 존재하지만 스캐폴드 등 비정형 구조({"versions": []})라
        # metadata/releases 키가 없을 수 있다 — 릴리스를 절대 막지 않는다 (실측: dogfood PR #1)
        if not isinstance(changelog_data, dict):
            changelog_data = {}
        changelog_data.setdefault("metadata", {})

        changelog_data["metadata"]["lastUpdated"] = timestamp
        changelog_data["metadata"]["currentVersion"] = version
        changelog_data["metadata"]["projectType"] = project_type
        changelog_data["metadata"]["projectTypes"] = project_types
        changelog_data["metadata"]["totalReleases"] = len(changelog_data.get("releases", [])) + 1
        changelog_data.setdefault("releases", []).insert(0, new_release)

        with open('CHANGELOG.json', 'w', encoding='utf-8') as f:
            json.dump(changelog_data, f, indent=2, ensure_ascii=False)

        print("\n✅ CHANGELOG.json 업데이트 완료!")
        return 0

    except Exception as e:
        print(f"❌ update-from-summary 실패: {e}")
        traceback.print_exc()
        return 1


def cmd_generate_md() -> int:
    """CHANGELOG.json을 기반으로 CHANGELOG.md 재생성."""
    try:
        with open('CHANGELOG.json', 'r', encoding='utf-8') as f:
            data = json.load(f)

        with open('CHANGELOG.md', 'w', encoding='utf-8') as f:
            f.write("# Changelog\n\n")

            metadata = data.get('metadata', {})
            current_version = metadata.get('currentVersion', 'Unknown')
            last_updated = metadata.get('lastUpdated', 'Unknown')

            f.write(f"**현재 버전:** {current_version}  \n")
            f.write(f"**마지막 업데이트:** {last_updated}  \n\n")
            f.write("---\n\n")

            for release in data.get('releases', []):
                version = release.get('version', 'Unknown')
                date = release.get('date', 'Unknown')
                pr_number = release.get('pr_number')

                f.write(f"## [{version}] - {date}\n\n")

                if pr_number is not None:
                    f.write(f"**PR:** #{pr_number}  \n\n")

                parsed = release.get('parsed_changes') or {}

                if parsed:
                    # 구조화된 데이터 출력
                    for _, items in parsed.items():
                        if not items:
                            continue
                        if isinstance(items, dict) and 'items' in items:
                            actual_items = items.get('items') or []
                            title = items.get('title') or ''
                        else:
                            actual_items = items
                            title = _normalize_text(_)

                        f.write(f"**{title}**\n")
                        for item in actual_items:
                            f.write(f"- {item}\n")
                        f.write("\n")
                else:
                    # 파싱 실패 시 raw_summary 출력
                    raw_summary = release.get('raw_summary', '').strip()
                    if raw_summary:
                        raw_summary = _clean_summary_noise(raw_summary)
                        if raw_summary:
                            f.write(raw_summary + "\n\n")
                        else:
                            f.write("*변경사항 정보 없음*\n\n")
                    else:
                        f.write("*변경사항 정보 없음*\n\n")

                f.write("---\n\n")

        print("✅ CHANGELOG.md 재생성 완료!")
        return 0

    except Exception as e:
        print(f"❌ CHANGELOG.md 생성 실패: {e}")
        traceback.print_exc()
        return 1


def cmd_export_release_notes(version: str, output_path: str | None) -> int:
    """CHANGELOG에서 해당 버전 릴리즈 노트를 생성."""
    notes_text = ""

    # 1) CHANGELOG.json 시도
    try:
        if os.path.isfile('CHANGELOG.json'):
            with open('CHANGELOG.json', 'r', encoding='utf-8') as f:
                changelog = json.load(f)
            releases = changelog.get('releases') or []
            matched = next((r for r in releases if str(r.get('version')) == str(version)), None)
            if matched:
                header = f"버전 {matched.get('version')} 업데이트\n\n"
                parsed_changes = matched.get('parsed_changes') or {}
                if parsed_changes:
                    category_blocks: list[str] = []
                    for _, value in parsed_changes.items():
                        title = (value.get('title') or '').strip()
                        items = [it for it in (value.get('items') or []) if it]
                        if title and items:
                            block = "**" + title + "**\n" + "\n".join("- " + it for it in items)
                            category_blocks.append(block)
                    body = "\n\n".join(category_blocks) if category_blocks else (matched.get('raw_summary') or '').strip()
                else:
                    body = (matched.get('raw_summary') or '').strip()
                notes_text = (header + (body or "")).strip()
    except Exception:
        pass

    # 2) CHANGELOG.md 폴백
    if not notes_text and os.path.isfile('CHANGELOG.md'):
        try:
            with open('CHANGELOG.md', 'r', encoding='utf-8') as f:
                md = f.read()
            pattern = re.compile(rf"^## \[{re.escape(str(version))}\].*$", re.MULTILINE)
            m = pattern.search(md)
            if m:
                start = m.end()
                next_m = re.search(r"^## \\[", md[start:], re.MULTILINE)
                section = md[start: start + next_m.start()] if next_m else md[start:]
                body = section.strip()
                notes_text = (f"버전 {version} 업데이트\n\n" + body).strip()
        except Exception:
            pass

    # 3) 최종 폴백
    if not notes_text:
        notes_text = f"버전 {version} 업데이트\n앱 안정성 및 사용자 경험이 개선되었습니다."

    if output_path:
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(notes_text)
    else:
        sys.stdout.write(notes_text + "\n")
    return 0


# ------------------------ ai-summary 엔진 체인 ------------------------

_AI_DEFAULT_BASE_URL = "https://models.github.ai/inference"
_AI_DEFAULT_MODEL = "openai/gpt-4o-mini"


def _build_ai_prompt(commit_lines: list[str], pr_title: str | None, version: str) -> str:
    """AI에게 보낼 한국어 릴리즈 요약 프롬프트를 구성.

    요청하는 출력 형식은 규칙 기반 폴백 렌더러(render_fallback_md)와 동일한
    형식으로 맞춘다 — 다운스트림(릴리즈 노트 소비자)이 엔진과 무관하게 단일
    형식만 보게 하기 위함이다.
    """
    parts = [
        "아래 커밋 목록을 바탕으로 한국어 릴리즈 요약을 작성해줘.",
        f"출력 형식: 첫 줄은 '## [{version}]' 헤더로 시작하고,",
        "해당 항목이 있는 섹션만 다음 이름으로 작성해줘:",
        "'### ✨ 기능', '### 🐛 수정', '### 📝 문서', '### ♻️ 리팩토링', '### ✅ 테스트', '### 🔧 변경사항'.",
        "각 항목은 '- '로 시작하는 불릿으로 작성해줘.",
    ]
    if pr_title:
        parts.append(f"PR 제목: {pr_title}")
    parts.append("커밋 목록:")
    parts.extend(f"- {line}" for line in commit_lines)
    return "\n".join(parts)


def call_openai_compatible(base_url: str, token: str, model: str, prompt: str) -> str:
    """OpenAI 호환 /chat/completions 엔드포인트 호출 후 응답 텍스트 반환."""
    url = base_url.rstrip('/') + "/chat/completions"
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    return body["choices"][0]["message"]["content"]


def cmd_ai_summary(commits_file: str, version: str, output_path: str, pr_title: str | None) -> int:
    """커밋 목록을 읽어 AI(우선) 또는 규칙 기반 폴백으로 릴리즈 요약을 생성."""
    try:
        with open(commits_file, 'r', encoding='utf-8') as f:
            commit_lines = [line.rstrip('\n').rstrip('\r') for line in f]
    except Exception:
        commit_lines = []

    ai_api_key = os.environ.get('AI_API_KEY')
    ai_base_url = os.environ.get('AI_API_BASE_URL') or _AI_DEFAULT_BASE_URL
    ai_model = os.environ.get('AI_MODEL') or _AI_DEFAULT_MODEL
    github_token = os.environ.get('GITHUB_TOKEN')

    engine = None
    summary_text = None
    prompt = _build_ai_prompt(commit_lines, pr_title, version)

    if ai_api_key:
        try:
            candidate = call_openai_compatible(ai_base_url, ai_api_key, ai_model, prompt)
            if candidate and candidate.strip():
                summary_text = candidate
                engine = "user-api"
            else:
                print("[warn] user-api failed: empty content in response", file=sys.stderr)
        except Exception as e:
            print(f"[warn] user-api failed: {e}", file=sys.stderr)

    if summary_text is None and github_token:
        try:
            # GitHub Models는 자체 모델 카탈로그만 서빙한다 — 사용자 API용으로
            # AI_MODEL이 오버라이드돼 있어도 여기서는 기본 모델을 쓴다
            # (커스텀 모델명은 models.github.ai에서 404).
            candidate = call_openai_compatible(_AI_DEFAULT_BASE_URL, github_token, _AI_DEFAULT_MODEL, prompt)
            if candidate and candidate.strip():
                summary_text = candidate
                engine = "github-models"
            else:
                print("[warn] github-models failed: empty content in response", file=sys.stderr)
        except Exception as e:
            print(f"[warn] github-models failed: {e}", file=sys.stderr)

    if summary_text is None:
        classified = classify_commits(commit_lines)
        summary_text = render_fallback_md(classified, version)
        engine = "fallback"

    write_ok = True
    try:
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(summary_text)
    except Exception as e:
        # 파일을 못 쓴 사실을 숨기지 않는다 — ok=false로 보고하고,
        # 요약 텍스트는 stderr로 구제 출력한다. 종료 코드는 0 유지
        # (워크플로우 파이프라인을 끊지 않기 위한 계약).
        write_ok = False
        print(f"[warn] output write failed: {e}", file=sys.stderr)
        print(summary_text, file=sys.stderr)

    print(json.dumps({"ok": write_ok, "engine": engine, "output": output_path}))
    return 0


# ------------------------------- CLI -------------------------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog='changelog_manager',
        description='통합 체인지로그 매니저',
        add_help=True
    )
    sub = parser.add_subparsers(dest='command', required=True)

    sub.add_parser('update-from-summary', help='PR body에서 CHANGELOG.json 갱신')
    sub.add_parser('generate-md', help='CHANGELOG.json → CHANGELOG.md 생성')

    p_export = sub.add_parser('export', help='특정 버전 릴리즈 노트 추출')
    p_export.add_argument('--version', required=True, help='버전 번호')
    p_export.add_argument('--output', help='출력 파일 경로 (없으면 stdout)')

    p_ai_summary = sub.add_parser('ai-summary', help='커밋 목록으로 AI/규칙 기반 릴리즈 요약 생성')
    p_ai_summary.add_argument('--commits-file', required=True, help='커밋 제목 목록 파일 (한 줄당 1개)')
    p_ai_summary.add_argument('--version', required=True, help='버전 번호')
    p_ai_summary.add_argument('--output', required=True, help='요약 결과를 저장할 파일 경로')
    p_ai_summary.add_argument('--pr-title', help='PR 제목 (프롬프트 컨텍스트로 사용, 선택)')

    args = parser.parse_args(argv)

    if args.command == 'update-from-summary':
        return cmd_update_from_summary()
    if args.command == 'generate-md':
        return cmd_generate_md()
    if args.command == 'export':
        return cmd_export_release_notes(args.version, args.output)
    if args.command == 'ai-summary':
        return cmd_ai_summary(args.commits_file, args.version, args.output, args.pr_title)
    return 2


if __name__ == '__main__':
    sys.exit(main())
