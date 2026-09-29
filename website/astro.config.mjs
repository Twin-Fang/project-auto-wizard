// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

const REPO = 'https://github.com/Twin-Fang/project-auto-wizard';

// 프로젝트 Pages는 /<레포명>/ 아래에서 서빙되므로 base를 맞춰야 에셋 경로가 깨지지 않는다.
export default defineConfig({
  site: 'https://twin-fang.github.io',
  base: '/project-auto-wizard',
  integrations: [
    starlight({
      title: 'project-auto-wizard',
      description: 'One command sets up versioning, CHANGELOG, GitHub Releases and CI/CD in your repo.',
      // 영어가 루트(/), 나머지는 /ko/ 등 하위 경로. 번역이 없는 페이지는 영어로 보인다.
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
        ko: { label: '한국어', lang: 'ko' },
        'zh-cn': { label: '简体中文', lang: 'zh-CN' },
        ja: { label: '日本語', lang: 'ja' },
      },
      social: [{ icon: 'github', label: 'GitHub', href: REPO }],
      editLink: { baseUrl: `${REPO}/edit/main/website/` },
      customCss: ['./src/styles/custom.css'],
      sidebar: [
        {
          label: 'Start',
          translations: { ko: '시작하기', 'zh-CN': '开始', ja: 'はじめに' },
          items: ['start/introduction', 'start/quickstart', 'start/installation'],
        },
        {
          label: 'Understand',
          translations: { ko: '이해하기', 'zh-CN': '原理', ja: '仕組み' },
          items: [
            'understand/how-it-works',
            'understand/release-flow',
            'understand/branch-strategies',
            'understand/summary-engine',
          ],
        },
        {
          label: 'Project types',
          translations: { ko: '프로젝트 타입', 'zh-CN': '项目类型', ja: 'プロジェクトタイプ' },
          items: [
            'project-types/common',
            'project-types/spring',
            'project-types/flutter',
            'project-types/react-next',
            'project-types/python',
            'project-types/go',
            'project-types/release-only',
          ],
        },
        {
          label: 'Operate',
          translations: { ko: '운영', 'zh-CN': '运维', ja: '運用' },
          items: ['operate/status', 'operate/doctor', 'operate/updating', 'operate/uninstall', 'operate/logs'],
        },
        {
          label: 'Reference',
          translations: { ko: '레퍼런스', 'zh-CN': '参考', ja: 'リファレンス' },
          items: ['reference/cli', 'reference/version-yml', 'reference/faq', 'reference/comparison'],
        },
      ],
    }),
  ],
});
