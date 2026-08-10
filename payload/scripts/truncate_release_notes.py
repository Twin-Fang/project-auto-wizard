#!/usr/bin/env python3
"""
truncate_release_notes.py — truncate a release notes file in place to fit a
store-imposed length limit (stdlib only).

This script is copied into user repos (.github/scripts/) by project-auto-wizard
and is called by the Flutter deploy workflows right before store upload
(Google Play, Firebase App Distribution, App Store Connect) — each of which
enforces its own release-notes length limit.

Usage:
    truncate_release_notes.py <file> <limit> <char|byte>

Behavior:
    - Missing file: no-op, exit 0 (a missing notes file is not a reason to
      block deployment).
    - File within limit: left unchanged, exit 0.
    - File over limit: truncated in place to `limit`, no marker text added.
      char mode counts Unicode code points (Google Play); byte mode counts
      UTF-8 bytes and never splits a multi-byte character (Firebase / App
      Store Connect).
    - Bytes in the input that are not valid UTF-8 are replaced, never fatal.

Contract:
    - Exit 0 on success (including the no-op cases above).
    - Exit 1 if `limit` is not a positive integer (caller bug).
    - Exit 2 on argument-parsing errors (argparse default — wrong arg count,
      non-integer limit, unknown mode).
"""

import argparse
import sys


def log(message):
    print(message, file=sys.stderr)


def truncate_text(text, limit, mode):
    if mode == "char":
        return text[:limit]
    return text.encode("utf-8")[:limit].decode("utf-8", errors="ignore")


def run(path, limit, mode):
    try:
        with open(path, "r", encoding="utf-8", newline="", errors="replace") as f:
            text = f.read()
    except FileNotFoundError:
        log(f"릴리즈 노트 파일 없음, 건너뜀: {path}")
        return 0

    length = len(text) if mode == "char" else len(text.encode("utf-8"))
    if length <= limit:
        log(f"한도 이내 ({length}/{limit} {mode}), 자르지 않음: {path}")
        return 0

    truncated = truncate_text(text, limit, mode)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(truncated)

    log(f"한도 초과 ({length} -> {limit} {mode} 이하로 절단): {path}")
    return 0


def build_parser():
    parser = argparse.ArgumentParser(prog="truncate_release_notes.py")
    parser.add_argument("file")
    parser.add_argument("limit", type=int)
    parser.add_argument("mode", choices=["char", "byte"])
    return parser


def main(argv=None):
    sys.stdout.reconfigure(errors="replace")
    sys.stderr.reconfigure(errors="replace")

    parser = build_parser()
    args = parser.parse_args(argv)

    if args.limit <= 0:
        log(f"ERROR: limit은 양수여야 함: {args.limit}")
        return 1

    return run(args.file, args.limit, args.mode)


if __name__ == "__main__":
    sys.exit(main())
