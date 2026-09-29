---
title: Node, React Native, Expo, basic
description: Types that get release automation only.
---

These types get [release automation](../common/) and no type-specific CI/CD. Add your own build and deploy workflows next to the installed ones.

| Type | Detected from | Version synced to |
|---|---|---|
| `node` | `package.json` without `react`, `next`, `react-native` or `expo` dependencies, and no other type found | `package.json` |
| `react-native` | `package.json` with a `react-native` dependency | `Info.plist` and `build.gradle` |
| `react-native-expo` | `package.json` with an `expo` dependency | `app.json` |
| `basic` | nothing else matched | `version.yml` only |

`--deploy-style` does not apply to these types.

## Publishing a package

The release flow ends with a tag and a GitHub Release. To publish to npm or another registry, add a workflow that runs on the Release event:

```yaml
on:
  release:
    types: [published]
```

Check out the release tag in that workflow so it publishes exactly what was released. This repository publishes itself to npm this way.

A Release created with `GITHUB_TOKEN` does not trigger other workflows, so this needs `WORKFLOW_PAT` registered for `RELEASE-PUBLISH`. See [Release flow](../../understand/release-flow/#publishing-packages).
