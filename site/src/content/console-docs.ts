import type { DocsLocale, DocsPageCopy } from './docs';

export const consoleDocsCopy: Record<DocsLocale, DocsPageCopy> = {
  en: {
    meta: {
      title: 'mem9 Console Docs | User Guide',
      description:
        'User guide for mem9 Console: sign in, install mem9, claim API keys, manage spaces, browse memories, build Space Chains, and monitor usage.',
    },
    hero: {
      eyebrow: 'Console Docs',
      title: 'mem9 Console User Guide',
      intro:
        'mem9 Console is the hosted control center for projects, memory spaces, API keys, memory review, Space Chains, usage, billing, and account settings. This guide explains the product from the user workflow, not from the API contract.',
      summaryTitle: 'What this guide covers',
      summaryBullets: [
        'How to sign in and understand organization, project, and space context.',
        'How to install mem9 or claim an existing API key into a Space.',
        'How to inspect, create, edit, filter, and delete memories.',
        'How Space Chains, usage, billing, and settings fit into daily operations.',
      ],
      tocTitle: 'On this page',
    },
    search: {
      label: 'Search docs',
      placeholder: 'Search navigation or content',
      empty: 'No matching docs.',
    },
    backToTopLabel: 'Back to top',
    tocGroups: [
      { title: 'Start Here', sectionIDs: ['quick-start', 'account-model', 'install-and-claim'] },
      { title: 'Memory Workflows', sectionIDs: ['spaces', 'space-detail', 'memories'] },
      { title: 'Advanced Workflows', sectionIDs: ['space-chains', 'webhooks', 'usage-billing-settings', 'safe-operations'] },
    ],
    sections: [
      {
        id: 'quick-start',
        label: '01',
        title: 'Quick Start',
        intro: 'Use Console after you have a mem9 account or an API key you want to manage.',
        bullets: [
          'Open mem9 Console from the Log in menu and sign in with your account.',
          'Choose the organization and project from the shell before changing resources.',
          'Use Install mem9 when you need the official OpenClaw onboarding prompt.',
          'Use Claim API key when you already have a mem9 API key and want to attach it to a Space.',
          'Open Space or Memories to review what your agents are storing.',
        ],
      },
      {
        id: 'account-model',
        label: '02',
        title: 'Organization, Project, and Space',
        intro: 'Console groups resources so a team can manage memory without mixing every key together.',
        subsections: [
          {
            title: 'Organization',
            paragraphs: [
              'An organization owns billing, usage, settings, and member-level permissions. The sidebar organization selector changes which organization you are operating in.',
            ],
          },
          {
            title: 'Project',
            paragraphs: [
              'A project is the working container for spaces and Space Chains. Use the project switcher in the header to move between products, environments, or teams.',
            ],
          },
          {
            title: 'Space',
            paragraphs: [
              'A Space is the unit that receives a mem9 tenant API key. Your agents write and recall memories through that key, while Console uses the Space to show metrics, keys, imports, and memory tools.',
            ],
          },
        ],
      },
      {
        id: 'install-and-claim',
        label: '03',
        title: 'Install mem9 and Claim API Keys',
        intro: 'There are two common onboarding paths.',
        subsections: [
          {
            title: 'Install mem9',
            bullets: [
              'Open Install mem9 in the sidebar.',
              'Copy the onboarding prompt into OpenClaw.',
              'Follow SKILL.md to provision or reconnect a hosted mem9 API key.',
              'Return to Console when you want to inspect spaces and memory activity.',
            ],
          },
          {
            title: 'Claim an existing API key',
            bullets: [
              'Open the claim flow when you already have an anonymous or previously generated mem9 API key.',
              'Choose an organization, project, and destination Space.',
              'Create a new Space or attach the key to an existing Space without an active key.',
              'After a successful claim, open that Space to inspect the key and memory data.',
            ],
          },
        ],
      },
      {
        id: 'spaces',
        label: '04',
        title: 'Spaces',
        intro: 'The Space page is the project-level list of memory spaces.',
        bullets: [
          'Create a Space for a product, environment, agent group, or isolated memory boundary.',
          'Use the table to compare names, descriptions, and whether each Space already has an API key.',
          'Open a Space by selecting its name.',
          'Use the row actions to edit the Space, configure or replace its key, or delete it when it is no longer needed.',
        ],
      },
      {
        id: 'space-detail',
        label: '05',
        title: 'Space Detail',
        intro: 'Space detail is where a Space becomes operational.',
        subsections: [
          {
            title: 'Tenant key',
            bullets: [
              'Configure a key before expecting memory data to load.',
              'Reveal and copy an active key only when your role can manage the Space.',
              'Treat revealed keys as secrets; Console shows masked keys by default.',
            ],
          },
          {
            title: 'Metrics and imports',
            bullets: [
              'Use metric cards to check total, pinned, and insight memories.',
              'Use the latest import panel to see whether imports are running, completed, or failed.',
              'Use the Space switcher to compare another Space without returning to the list.',
            ],
          },
          {
            title: 'Memory workbench',
            bullets: [
              'Create a memory directly from Console.',
              'Turn on Smart ingest when you want Console to extract durable facts from a pasted message.',
              'Edit, delete, bulk delete, filter, sort, and refresh active memories.',
              'Use appId when you need to isolate memories within the same Space key.',
            ],
          },
        ],
      },
      {
        id: 'memories',
        label: '06',
        title: 'Memories',
        intro: 'The Memories page is a project-level explorer for one selected Space.',
        bullets: [
          'Pick a Space from the header selector.',
          'Filter by text, type, state, agent, tags, or appId.',
          'Open a memory to inspect content, metadata, tags, score, confidence, session, agent, version, and timestamps.',
          'If the selected Space has no key, open Space key settings before browsing memories.',
        ],
      },
      {
        id: 'space-chains',
        label: '07',
        title: 'Space Chains',
        intro: 'A Space Chain lets one chain key recall across several Spaces in a controlled order.',
        subsections: [
          {
            title: 'Create or import',
            bullets: [
              'Create Space Chain to start a new chain in the current project.',
              'Import key when you already have a chain key and want Console to manage or test it.',
              'Open a chain to edit its details, keys, nodes, and memory tools.',
            ],
          },
          {
            title: 'Nodes and routing',
            bullets: [
              'Add Spaces that already have active keys.',
              'Move nodes up or down to control recall order.',
              'Save node order before depending on chain recall.',
              'Use routing policy prompts on nodes when a Space should only be searched for certain kinds of questions.',
            ],
          },
          {
            title: 'Chain keys and testing',
            bullets: [
              'Create or bind chain keys from the detail page.',
              'Disable a chain key when it should no longer be used.',
              'Use the recall and memory tools to compare chain behavior with a single Space.',
            ],
          },
        ],
      },
      {
        id: 'webhooks',
        label: '08',
        title: 'Webhooks',
        intro: 'The Webhooks page manages event subscriptions for Spaces and Space Chains in the current project.',
        subsections: [
          {
            title: 'Project view',
            bullets: [
              'Open Webhooks from the Activity sidebar.',
              'Use All, Space, or Space Chain filters to narrow the project-level list.',
              'The table shows the endpoint name, scope, URL host, enabled state, subscribed events, last delivery status, and update time.',
              'If one Space is not usable, the project list continues to show reachable scopes instead of blocking the whole page.',
            ],
          },
          {
            title: 'Create and edit',
            bullets: [
              'Create Webhook opens a modal where you choose Space or Space Chain, pick the resource, enter the URL, select events, and enable or disable the endpoint.',
              'Production endpoints should use HTTPS. Local HTTP URLs are only for local development receivers.',
              'The signing secret is shown only after create or rotate-secret. Copy it before closing the modal.',
            ],
          },
          {
            title: 'Actions and deliveries',
            bullets: [
              'Use the row menu to edit, test, view deliveries, rotate the signing secret, enable or disable, or delete an endpoint.',
              'Test queues a `webhook.test` delivery so you can verify the receiver before relying on live events.',
              'The deliveries drawer shows event type, event id, delivery status, attempt count, HTTP status, last error, retry time, and delivered time.',
            ],
          },
        ],
      },
      {
        id: 'usage-billing-settings',
        label: '09',
        title: 'Usage, Billing, and Settings',
        intro: 'These pages operate at the organization level.',
        subsections: [
          {
            title: 'Usage',
            bullets: [
              'Review memory recall and memory write request usage.',
              'Change the date range, inspect daily trends, and page through usage events.',
              'Use event rows to understand source, API key, agent, included usage, and on-demand usage.',
            ],
          },
          {
            title: 'Billing',
            bullets: [
              'Review the current plan, subscription period, included launch access, and on-demand settings.',
              'Payment, subscription, and invoice actions may appear as coming soon depending on the rollout state.',
            ],
          },
          {
            title: 'Settings',
            bullets: [
              'Use Settings for account and organization-level management as Console evolves.',
              'Use the account menu for theme, language, and logout.',
            ],
          },
        ],
      },
      {
        id: 'safe-operations',
        label: '10',
        title: 'Safe Operations',
        intro: 'Console exposes powerful controls, so treat changes deliberately.',
        bullets: [
          'Do not reveal or copy API keys unless you are about to configure a trusted client.',
          'Check delete previews and confirmation dialogs before deleting Spaces or Space Chains.',
          'Use separate Spaces for data that should not be searched together.',
          'Use appId filters when a single key serves multiple applications.',
          'When memory results look wrong, first check the selected organization, project, Space, key status, and appId filter.',
        ],
      },
    ],
  },
  zh: {
    meta: {
      title: 'mem9 Console 文档 | 用户指南',
      description:
        'mem9 Console 用户指南：登录、安装 mem9、claim API key、管理 Space、查看记忆、创建 Space Chain、查看用量和账单。',
    },
    hero: {
      eyebrow: 'Console 文档',
      title: 'mem9 Console 用户指南',
      intro:
        'mem9 Console 是托管版控制台，用来管理项目、memory space、API key、记忆审查、Space Chain、用量、账单和账号设置。本指南从用户操作角度说明如何使用 Console。',
      summaryTitle: '本指南包含',
      summaryBullets: [
        '如何登录，并理解 organization、project、space 的关系。',
        '如何安装 mem9，或把已有 API key claim 到 Space。',
        '如何查看、创建、编辑、筛选和删除记忆。',
        'Space Chain、用量、账单和设置在日常使用中如何配合。',
      ],
      tocTitle: '本页目录',
    },
    search: {
      label: '搜索文档',
      placeholder: '搜索导航或正文内容',
      empty: '没有匹配的文档。',
    },
    backToTopLabel: '返回顶部',
    tocGroups: [
      { title: '开始', sectionIDs: ['quick-start', 'account-model', 'install-and-claim'] },
      { title: '记忆工作流', sectionIDs: ['spaces', 'space-detail', 'memories'] },
      { title: '高级工作流', sectionIDs: ['space-chains', 'webhooks', 'usage-billing-settings', 'safe-operations'] },
    ],
    sections: [
      {
        id: 'quick-start',
        label: '01',
        title: '快速开始',
        intro: '当你已经有 mem9 账号，或有一个想纳入管理的 API key 时，就可以使用 Console。',
        bullets: [
          '从 Log in 菜单打开 mem9 Console，并登录账号。',
          '修改资源前，先在界面中确认当前 organization 和 project。',
          '需要官方 OpenClaw 安装提示词时，打开 Install mem9。',
          '已经有 mem9 API key 时，使用 Claim API key 把它绑定到一个 Space。',
          '打开 Space 或 Memories 查看 agent 正在保存的记忆。',
        ],
      },
      {
        id: 'account-model',
        label: '02',
        title: 'Organization、Project 和 Space',
        intro: 'Console 用分层资源来管理记忆，避免所有 key 和数据混在一起。',
        subsections: [
          {
            title: 'Organization',
            paragraphs: [
              'Organization 拥有账单、用量、设置和成员权限。侧边栏的 organization selector 会切换当前操作范围。',
            ],
          },
          {
            title: 'Project',
            paragraphs: [
              'Project 是 Space 和 Space Chain 的工作容器。用顶部 project switcher 在不同产品、环境或团队之间切换。',
            ],
          },
          {
            title: 'Space',
            paragraphs: [
              'Space 是承载 mem9 tenant API key 的单位。Agent 通过这个 key 写入和召回记忆；Console 通过 Space 展示指标、key、导入任务和记忆工具。',
            ],
          },
        ],
      },
      {
        id: 'install-and-claim',
        label: '03',
        title: '安装 mem9 和 Claim API key',
        intro: '常见 onboarding 有两条路径。',
        subsections: [
          {
            title: 'Install mem9',
            bullets: [
              '在侧边栏打开 Install mem9。',
              '把页面中的 onboarding prompt 复制到 OpenClaw。',
              '按照 SKILL.md 完成 hosted mem9 API key 的 provision 或 reconnect。',
              '回到 Console 查看 Space 和工作区活动。',
            ],
          },
          {
            title: 'Claim 已有 API key',
            bullets: [
              '当你已经有匿名或旧版生成的 mem9 API key 时，打开 claim 流程。',
              '选择 organization、project 和目标 Space。',
              '创建新 Space，或把 key 绑定到一个还没有 active key 的已有 Space。',
              'Claim 成功后，打开该 Space 查看 key 和记忆数据。',
            ],
          },
        ],
      },
      {
        id: 'spaces',
        label: '04',
        title: 'Spaces',
        intro: 'Space 页面是当前 project 下所有 memory space 的列表。',
        bullets: [
          '为产品、环境、agent 组或隔离边界创建 Space。',
          '通过表格查看名称、描述，以及每个 Space 是否已有 API key。',
          '点击 Space 名称进入详情页。',
          '通过行操作编辑 Space、配置或替换 key，或删除不再需要的 Space。',
        ],
      },
      {
        id: 'space-detail',
        label: '05',
        title: 'Space 详情',
        intro: 'Space 详情页是让一个 Space 真正可用的地方。',
        subsections: [
          {
            title: 'Tenant key',
            bullets: [
              '先配置 key，再期待记忆数据能够加载。',
              '只有具备管理权限时，才可以 reveal 并复制 active key。',
              '把 reveal 出来的 key 当作 secret 处理；Console 默认只显示 masked key。',
            ],
          },
          {
            title: '指标和导入',
            bullets: [
              '通过指标卡查看 total、pinned、insight memories。',
              '通过 latest import 面板查看导入任务正在运行、已完成还是失败。',
              '用 Space switcher 对比另一个 Space，不必回到列表页。',
            ],
          },
          {
            title: 'Memory workbench',
            bullets: [
              '直接在 Console 中创建 memory。',
              '需要从一段消息中提取稳定事实时，开启 Smart ingest。',
              '编辑、删除、批量删除、筛选、排序和刷新 active memories。',
              '同一个 Space key 服务多个应用时，用 appId 做隔离。',
            ],
          },
        ],
      },
      {
        id: 'memories',
        label: '06',
        title: 'Memories',
        intro: 'Memories 页面是在 project 级别查看某个 Space 记忆的 explorer。',
        bullets: [
          '先在页面顶部选择一个 Space。',
          '按正文、类型、状态、agent、tags 或 appId 进行筛选。',
          '打开单条 memory 查看内容、metadata、tags、score、confidence、session、agent、version 和时间戳。',
          '如果选中的 Space 没有 key，先进入 Space key settings 配置 key。',
        ],
      },
      {
        id: 'space-chains',
        label: '07',
        title: 'Space Chains',
        intro: 'Space Chain 让一个 chain key 按受控顺序跨多个 Space recall。',
        subsections: [
          {
            title: '创建或导入',
            bullets: [
              '用 Create Space Chain 在当前 project 新建 chain。',
              '已经有 chain key 时，用 Import key 让 Console 管理或测试它。',
              '打开 chain 后，可以编辑详情、key、nodes 和记忆工具。',
            ],
          },
          {
            title: 'Nodes 和 routing',
            bullets: [
              '只能添加已经有 active key 的 Space。',
              '上移或下移 node 来控制 recall 顺序。',
              '依赖 chain recall 之前，先保存 node order。',
              '当某个 Space 只应该响应特定问题时，为 node 配置 routing policy prompt。',
            ],
          },
          {
            title: 'Chain key 和测试',
            bullets: [
              '在详情页创建或绑定 chain key。',
              '不再使用某个 chain key 时，将它 disable。',
              '使用 recall 和 memory 工具对比 chain 与单个 Space 的行为。',
            ],
          },
        ],
      },
      {
        id: 'webhooks',
        label: '08',
        title: 'Webhooks',
        intro: 'Webhooks 页面用于管理当前 project 下 Space 和 Space Chain 的事件订阅。',
        subsections: [
          {
            title: 'Project 视图',
            bullets: [
              '从 Activity 侧边栏进入 Webhooks。',
              '用 All、Space、Space Chain filter 缩小项目级列表。',
              '表格会显示 endpoint 名称、scope、URL host、启用状态、订阅事件、最近投递状态和更新时间。',
              '如果某个 Space 暂时不可用，项目列表会继续显示其它可访问 scope，而不是卡住整页。',
            ],
          },
          {
            title: '创建和编辑',
            bullets: [
              'Create Webhook 会打开表单，选择 Space 或 Space Chain、选择资源、填写 URL、选择事件，并设置是否启用。',
              '生产环境 endpoint 应使用 HTTPS。本地 HTTP URL 只用于本地开发 receiver。',
              'Signing secret 只会在 create 或 rotate-secret 后显示一次，关闭弹窗前需要复制保存。',
            ],
          },
          {
            title: '操作和投递记录',
            bullets: [
              '行菜单支持 edit、test、view deliveries、rotate secret、enable / disable 和 delete。',
              'Test 会排队一个 `webhook.test` delivery，方便你在依赖真实事件之前验证 receiver。',
              'Deliveries drawer 会显示 event type、event id、状态、尝试次数、HTTP 状态、最近错误、下次重试时间和成功投递时间。',
            ],
          },
        ],
      },
      {
        id: 'usage-billing-settings',
        label: '09',
        title: 'Usage、Billing 和 Settings',
        intro: '这些页面作用在 organization 层级。',
        subsections: [
          {
            title: 'Usage',
            bullets: [
              '查看 memory recall 和 memory write request 的用量。',
              '切换日期范围，查看每日趋势，并分页浏览 usage events。',
              '通过事件行理解 source、API key、agent、included usage 和 on-demand usage。',
            ],
          },
          {
            title: 'Billing',
            bullets: [
              '查看当前 plan、subscription period、included launch access 和 on-demand 设置。',
              '支付、订阅和发票操作可能会根据 rollout 状态显示为 coming soon。',
            ],
          },
          {
            title: 'Settings',
            bullets: [
              'Settings 用于 Console 逐步开放的账号和 organization 级管理。',
              '账号菜单中可以切换 theme、language，或 logout。',
            ],
          },
        ],
      },
      {
        id: 'safe-operations',
        label: '10',
        title: '安全操作建议',
        intro: 'Console 暴露了关键控制能力，操作时要有明确意图。',
        bullets: [
          '只有在要配置可信 client 时，才 reveal 或复制 API key。',
          '删除 Space 或 Space Chain 前，仔细阅读预览和确认弹窗。',
          '不应该混搜的数据放进不同 Space。',
          '单个 key 服务多个应用时，用 appId filter 进行隔离。',
          '记忆结果不符合预期时，先检查 organization、project、Space、key 状态和 appId filter。',
        ],
      },
    ],
  },
  ja: {
    meta: {
      title: 'mem9 Console Docs | ユーザーガイド',
      description:
        'mem9 Console の使い方。サインイン、インストール、API key の claim、Space、Memory、Space Chain、Usage、Billing を説明します。',
    },
    hero: {
      eyebrow: 'Console Docs',
      title: 'mem9 Console ユーザーガイド',
      intro:
        'mem9 Console は、project、memory space、API key、memory review、Space Chain、usage、billing、account settings を管理する hosted control center です。',
      summaryTitle: 'このガイドの内容',
      summaryBullets: [
        'organization、project、space の関係。',
        'mem9 の install と既存 API key の claim。',
        'memory の確認、作成、編集、filter、削除。',
        'Space Chain、usage、billing、settings の使いどころ。',
      ],
      tocTitle: 'On this page',
    },
    search: {
      label: 'ドキュメントを検索',
      placeholder: 'ナビゲーションまたは本文を検索',
      empty: '一致するドキュメントがありません。',
    },
    backToTopLabel: 'ページ上部へ戻る',
    tocGroups: [
      { title: 'Start Here', sectionIDs: ['quick-start', 'account-model', 'install-and-claim'] },
      { title: 'Memory Workflows', sectionIDs: ['spaces', 'space-detail', 'memories'] },
      { title: 'Advanced Workflows', sectionIDs: ['space-chains', 'webhooks', 'usage-billing-settings', 'safe-operations'] },
    ],
    sections: [
      {
        id: 'quick-start',
        label: '01',
        title: 'Quick Start',
        bullets: [
          'Log in メニューから mem9 Console を開き、サインインします。',
          '変更前に現在の organization と project を確認します。',
          'OpenClaw の公式 onboarding prompt が必要なときは Install mem9 を開きます。',
          '既存の mem9 API key は Claim API key で Space に紐づけます。',
          'Space または Memories で agent が保存している memory を確認します。',
        ],
      },
      {
        id: 'account-model',
        label: '02',
        title: 'Organization, Project, Space',
        subsections: [
          { title: 'Organization', paragraphs: ['Organization は billing、usage、settings、権限の単位です。'] },
          { title: 'Project', paragraphs: ['Project は Space と Space Chain の作業コンテナです。'] },
          { title: 'Space', paragraphs: ['Space は mem9 tenant API key を持つ単位です。agent はこの key で memory を write / recall します。'] },
        ],
      },
      {
        id: 'install-and-claim',
        label: '03',
        title: 'Install and Claim',
        subsections: [
          {
            title: 'Install mem9',
            bullets: ['Install mem9 を開く。', 'onboarding prompt を OpenClaw に貼り付ける。', 'SKILL.md に従って key を provision または reconnect する。'],
          },
          {
            title: 'Claim API key',
            bullets: ['既存 key がある場合に使う。', 'organization、project、Space を選ぶ。', '新しい Space を作るか、key のない既存 Space に紐づける。'],
          },
        ],
      },
      {
        id: 'spaces',
        label: '04',
        title: 'Spaces',
        bullets: [
          'product、environment、agent group、隔離境界ごとに Space を作成します。',
          '一覧で name、description、API key の有無を確認します。',
          'Space 名をクリックして detail を開きます。',
          '行メニューから edit、configure key、delete を実行します。',
        ],
      },
      {
        id: 'space-detail',
        label: '05',
        title: 'Space Detail',
        subsections: [
          { title: 'Tenant key', bullets: ['memory data を見る前に key を設定します。', 'key は必要な時だけ reveal / copy します。', 'Console は通常 masked key を表示します。'] },
          { title: 'Metrics and imports', bullets: ['total、pinned、insight memory を確認します。', 'latest import の状態を確認します。', 'Space switcher で別 Space に切り替えます。'] },
          { title: 'Memory workbench', bullets: ['memory を作成、編集、削除できます。', 'Smart ingest は pasted message から durable facts を抽出します。', 'appId で同じ key 内の用途を分離します。'] },
        ],
      },
      {
        id: 'memories',
        label: '06',
        title: 'Memories',
        bullets: [
          'Space を選んで memory を表示します。',
          'text、type、state、agent、tags、appId で filter します。',
          'memory detail で content、metadata、tags、score、confidence、session、agent、version、timestamps を確認します。',
          'Space に key がない場合は先に key settings を設定します。',
        ],
      },
      {
        id: 'space-chains',
        label: '07',
        title: 'Space Chains',
        subsections: [
          { title: 'Create or import', bullets: ['新しい chain を作るか、既存 chain key を import します。', 'detail で key、nodes、memory tools を管理します。'] },
          { title: 'Nodes and routing', bullets: ['active key のある Space を追加します。', 'node order が recall order になります。', 'routing policy prompt で検索条件を絞れます。'] },
          { title: 'Chain keys', bullets: ['chain key を作成または bind します。', '不要な key は disable します。', 'recall tools で single Space と比較します。'] },
        ],
      },
      {
        id: 'webhooks',
        label: '08',
        title: 'Webhooks',
        subsections: [
          { title: 'Project view', bullets: ['Activity sidebar から Webhooks を開きます。', 'All、Space、Space Chain filter で project-level list を絞り込みます。', 'table で endpoint、scope、URL host、enabled、events、last delivery を確認します。'] },
          { title: 'Create and edit', bullets: ['Space または Space Chain、resource、URL、events、enabled state を設定します。', 'production endpoint は HTTPS を使います。local HTTP は development 用です。', 'signing secret は create / rotate-secret の後に一度だけ表示されます。'] },
          { title: 'Actions and deliveries', bullets: ['row menu で edit、test、deliveries、rotate secret、enable / disable、delete を実行します。', 'deliveries drawer で status、attempts、HTTP status、last error、retry time を確認します。'] },
        ],
      },
      {
        id: 'usage-billing-settings',
        label: '09',
        title: 'Usage, Billing, Settings',
        subsections: [
          { title: 'Usage', bullets: ['recall / write request usage を確認します。', 'date range、daily trend、usage events を見ます。'] },
          { title: 'Billing', bullets: ['current plan、period、included access、on-demand settings を確認します。'] },
          { title: 'Settings', bullets: ['account と organization の管理、theme、language、logout に使います。'] },
        ],
      },
      {
        id: 'safe-operations',
        label: '10',
        title: 'Safe Operations',
        bullets: [
          'API key は信頼できる client に設定する時だけ reveal します。',
          'delete 前に preview と confirmation を確認します。',
          '混ぜたくない data は別 Space に分けます。',
          '結果が不自然な時は org、project、Space、key、appId filter を確認します。',
        ],
      },
    ],
  },
  ko: {
    meta: {
      title: 'mem9 Console Docs | 사용자 가이드',
      description:
        'mem9 Console 사용법: 로그인, 설치, API key claim, Space, Memory, Space Chain, Usage, Billing.',
    },
    hero: {
      eyebrow: 'Console Docs',
      title: 'mem9 Console 사용자 가이드',
      intro:
        'mem9 Console 은 project, memory space, API key, memory review, Space Chain, usage, billing, settings 를 관리하는 hosted control center 입니다.',
      summaryTitle: '이 가이드에서 다루는 내용',
      summaryBullets: [
        'organization, project, space 구조.',
        'mem9 설치와 기존 API key claim.',
        'memory 조회, 생성, 편집, 필터, 삭제.',
        'Space Chain, usage, billing, settings 사용 위치.',
      ],
      tocTitle: 'On this page',
    },
    search: {
      label: '문서 검색',
      placeholder: '내비게이션 또는 본문 검색',
      empty: '일치하는 문서가 없습니다.',
    },
    backToTopLabel: '맨 위로 이동',
    tocGroups: [
      { title: 'Start Here', sectionIDs: ['quick-start', 'account-model', 'install-and-claim'] },
      { title: 'Memory Workflows', sectionIDs: ['spaces', 'space-detail', 'memories'] },
      { title: 'Advanced Workflows', sectionIDs: ['space-chains', 'webhooks', 'usage-billing-settings', 'safe-operations'] },
    ],
    sections: [
      { id: 'quick-start', label: '01', title: 'Quick Start', bullets: ['Log in 메뉴에서 mem9 Console 에 로그인합니다.', '변경 전에 organization 과 project 를 확인합니다.', '공식 OpenClaw onboarding prompt 는 Install mem9 에서 복사합니다.', '기존 mem9 API key 는 Claim API key 로 Space 에 연결합니다.', 'Space 또는 Memories 에서 agent 가 저장한 memory 를 확인합니다.'] },
      { id: 'account-model', label: '02', title: 'Organization, Project, Space', subsections: [{ title: 'Organization', paragraphs: ['Organization 은 billing, usage, settings, 권한의 단위입니다.'] }, { title: 'Project', paragraphs: ['Project 는 Space 와 Space Chain 의 작업 컨테이너입니다.'] }, { title: 'Space', paragraphs: ['Space 는 mem9 tenant API key 를 가지는 단위이며 agent 는 이 key 로 memory 를 write / recall 합니다.'] }] },
      { id: 'install-and-claim', label: '03', title: 'Install and Claim', subsections: [{ title: 'Install mem9', bullets: ['Install mem9 를 엽니다.', 'onboarding prompt 를 OpenClaw 에 붙여 넣습니다.', 'SKILL.md 에 따라 key 를 provision 또는 reconnect 합니다.'] }, { title: 'Claim API key', bullets: ['이미 가진 key 를 관리 대상으로 가져올 때 사용합니다.', 'organization, project, Space 를 선택합니다.', '새 Space 를 만들거나 key 가 없는 기존 Space 에 연결합니다.'] }] },
      { id: 'spaces', label: '04', title: 'Spaces', bullets: ['제품, 환경, agent 그룹, 격리 경계별로 Space 를 만듭니다.', '목록에서 name, description, API key 상태를 확인합니다.', 'Space 이름을 눌러 detail 을 엽니다.', '행 메뉴에서 edit, configure key, delete 를 실행합니다.'] },
      { id: 'space-detail', label: '05', title: 'Space Detail', subsections: [{ title: 'Tenant key', bullets: ['memory data 를 보기 전에 key 를 설정합니다.', '필요할 때만 key 를 reveal / copy 합니다.', 'Console 은 기본적으로 masked key 를 보여줍니다.'] }, { title: 'Metrics and imports', bullets: ['total, pinned, insight memories 를 확인합니다.', 'latest import 상태를 확인합니다.', 'Space switcher 로 다른 Space 를 봅니다.'] }, { title: 'Memory workbench', bullets: ['memory 를 생성, 편집, 삭제합니다.', 'Smart ingest 는 pasted message 에서 durable facts 를 추출합니다.', 'appId 로 같은 key 안의 용도를 분리합니다.'] }] },
      { id: 'memories', label: '06', title: 'Memories', bullets: ['Space 를 선택해 memory 를 봅니다.', 'text, type, state, agent, tags, appId 로 필터합니다.', 'detail 에서 content, metadata, tags, score, confidence, session, agent, version, timestamps 를 확인합니다.', 'Space 에 key 가 없으면 key settings 를 먼저 설정합니다.'] },
      { id: 'space-chains', label: '07', title: 'Space Chains', subsections: [{ title: 'Create or import', bullets: ['새 chain 을 만들거나 기존 chain key 를 import 합니다.', 'detail 에서 key, nodes, memory tools 를 관리합니다.'] }, { title: 'Nodes and routing', bullets: ['active key 가 있는 Space 를 추가합니다.', 'node order 가 recall order 입니다.', 'routing policy prompt 로 검색 조건을 제한할 수 있습니다.'] }, { title: 'Chain keys', bullets: ['chain key 를 만들거나 bind 합니다.', '필요 없는 key 는 disable 합니다.', 'recall tools 로 single Space 와 비교합니다.'] }] },
      { id: 'webhooks', label: '08', title: 'Webhooks', subsections: [{ title: 'Project view', bullets: ['Activity sidebar 에서 Webhooks 를 엽니다.', 'All, Space, Space Chain filter 로 project list 를 좁힙니다.', 'table 에서 endpoint, scope, URL host, enabled, events, last delivery 를 확인합니다.'] }, { title: 'Create and edit', bullets: ['Space 또는 Space Chain, resource, URL, events, enabled state 를 설정합니다.', 'production endpoint 는 HTTPS 를 사용합니다.', 'signing secret 은 create / rotate-secret 뒤 한 번만 표시됩니다.'] }, { title: 'Actions and deliveries', bullets: ['row menu 에서 edit, test, deliveries, rotate secret, enable / disable, delete 를 실행합니다.', 'deliveries drawer 에서 status, attempts, HTTP status, last error, retry time 을 확인합니다.'] }] },
      { id: 'usage-billing-settings', label: '09', title: 'Usage, Billing, Settings', subsections: [{ title: 'Usage', bullets: ['recall / write request usage 를 확인합니다.', 'date range, daily trend, usage events 를 봅니다.'] }, { title: 'Billing', bullets: ['current plan, period, included access, on-demand settings 를 확인합니다.'] }, { title: 'Settings', bullets: ['account 와 organization 관리, theme, language, logout 에 사용합니다.'] }] },
      { id: 'safe-operations', label: '10', title: 'Safe Operations', bullets: ['API key 는 trusted client 설정 시에만 reveal 합니다.', 'delete 전에 preview 와 confirmation 을 확인합니다.', '섞이면 안 되는 data 는 별도 Space 로 나눕니다.', '결과가 이상하면 org, project, Space, key, appId filter 를 확인합니다.'] },
    ],
  },
  id: {
    meta: {
      title: 'mem9 Console Docs | Panduan Pengguna',
      description:
        'Panduan mem9 Console: login, install, claim API key, Space, Memory, Space Chain, Usage, Billing.',
    },
    hero: {
      eyebrow: 'Console Docs',
      title: 'Panduan mem9 Console',
      intro:
        'mem9 Console adalah pusat kontrol hosted untuk project, memory space, API key, review memory, Space Chain, usage, billing, dan settings.',
      summaryTitle: 'Isi panduan',
      summaryBullets: [
        'Model organization, project, dan space.',
        'Install mem9 dan claim API key yang sudah ada.',
        'Melihat, membuat, mengedit, memfilter, dan menghapus memory.',
        'Kapan memakai Space Chain, usage, billing, dan settings.',
      ],
      tocTitle: 'On this page',
    },
    search: {
      label: 'Cari dokumentasi',
      placeholder: 'Cari navigasi atau isi',
      empty: 'Tidak ada dokumen yang cocok.',
    },
    backToTopLabel: 'Kembali ke atas',
    tocGroups: [
      { title: 'Start Here', sectionIDs: ['quick-start', 'account-model', 'install-and-claim'] },
      { title: 'Memory Workflows', sectionIDs: ['spaces', 'space-detail', 'memories'] },
      { title: 'Advanced Workflows', sectionIDs: ['space-chains', 'webhooks', 'usage-billing-settings', 'safe-operations'] },
    ],
    sections: [
      { id: 'quick-start', label: '01', title: 'Quick Start', bullets: ['Buka mem9 Console dari menu Log in lalu masuk.', 'Pastikan organization dan project sebelum mengubah resource.', 'Gunakan Install mem9 untuk prompt onboarding OpenClaw resmi.', 'Gunakan Claim API key untuk menautkan key lama ke Space.', 'Buka Space atau Memories untuk melihat memory yang disimpan agent.'] },
      { id: 'account-model', label: '02', title: 'Organization, Project, Space', subsections: [{ title: 'Organization', paragraphs: ['Organization memiliki billing, usage, settings, dan permission.'] }, { title: 'Project', paragraphs: ['Project adalah container kerja untuk Space dan Space Chain.'] }, { title: 'Space', paragraphs: ['Space memegang mem9 tenant API key. Agent menulis dan recall memory melalui key itu.'] }] },
      { id: 'install-and-claim', label: '03', title: 'Install and Claim', subsections: [{ title: 'Install mem9', bullets: ['Buka Install mem9.', 'Tempel onboarding prompt ke OpenClaw.', 'Ikuti SKILL.md untuk provision atau reconnect key.'] }, { title: 'Claim API key', bullets: ['Pakai saat sudah punya key.', 'Pilih organization, project, dan Space.', 'Buat Space baru atau tautkan ke Space tanpa active key.'] }] },
      { id: 'spaces', label: '04', title: 'Spaces', bullets: ['Buat Space untuk produk, environment, grup agent, atau batas isolasi.', 'Lihat name, description, dan status API key di tabel.', 'Klik nama Space untuk detail.', 'Gunakan action row untuk edit, configure key, atau delete.'] },
      { id: 'space-detail', label: '05', title: 'Space Detail', subsections: [{ title: 'Tenant key', bullets: ['Set key sebelum melihat data memory.', 'Reveal / copy key hanya saat perlu.', 'Console menampilkan masked key secara default.'] }, { title: 'Metrics and imports', bullets: ['Cek total, pinned, dan insight memories.', 'Pantau latest import.', 'Gunakan Space switcher untuk pindah Space.'] }, { title: 'Memory workbench', bullets: ['Buat, edit, dan hapus memory.', 'Smart ingest mengekstrak durable facts dari pesan.', 'Gunakan appId untuk isolasi di dalam key yang sama.'] }] },
      { id: 'memories', label: '06', title: 'Memories', bullets: ['Pilih Space untuk melihat memory.', 'Filter berdasarkan text, type, state, agent, tags, atau appId.', 'Buka detail untuk content, metadata, tags, score, confidence, session, agent, version, dan timestamps.', 'Jika Space belum punya key, konfigurasi key dulu.'] },
      { id: 'space-chains', label: '07', title: 'Space Chains', subsections: [{ title: 'Create or import', bullets: ['Buat chain baru atau import chain key yang ada.', 'Detail page mengelola key, nodes, dan memory tools.'] }, { title: 'Nodes and routing', bullets: ['Tambahkan Space yang punya active key.', 'Node order menentukan recall order.', 'Routing policy prompt membatasi kapan node dicari.'] }, { title: 'Chain keys', bullets: ['Create atau bind chain key.', 'Disable key yang tidak dipakai.', 'Bandingkan chain dengan single Space memakai recall tools.'] }] },
      { id: 'webhooks', label: '08', title: 'Webhooks', subsections: [{ title: 'Project view', bullets: ['Buka Webhooks dari Activity sidebar.', 'Gunakan filter All, Space, atau Space Chain.', 'Tabel menampilkan endpoint, scope, URL host, enabled, events, dan last delivery.'] }, { title: 'Create and edit', bullets: ['Pilih Space atau Space Chain, resource, URL, events, dan enabled state.', 'Endpoint production harus HTTPS.', 'signing secret hanya muncul sekali setelah create atau rotate-secret.'] }, { title: 'Actions and deliveries', bullets: ['Row menu mendukung edit, test, deliveries, rotate secret, enable / disable, dan delete.', 'Drawer deliveries menampilkan status, attempts, HTTP status, last error, dan retry time.'] }] },
      { id: 'usage-billing-settings', label: '09', title: 'Usage, Billing, Settings', subsections: [{ title: 'Usage', bullets: ['Pantau recall / write request usage.', 'Lihat date range, daily trend, dan usage events.'] }, { title: 'Billing', bullets: ['Lihat current plan, period, included access, dan on-demand settings.'] }, { title: 'Settings', bullets: ['Untuk account, organization, theme, language, dan logout.'] }] },
      { id: 'safe-operations', label: '10', title: 'Safe Operations', bullets: ['Reveal API key hanya untuk trusted client.', 'Baca preview dan confirmation sebelum delete.', 'Pisahkan data sensitif ke Space berbeda.', 'Jika hasil aneh, cek org, project, Space, key, dan appId filter.'] },
    ],
  },
  th: {
    meta: {
      title: 'mem9 Console Docs | คู่มือผู้ใช้',
      description:
        'คู่มือ mem9 Console: login, install, claim API key, Space, Memory, Space Chain, Usage และ Billing.',
    },
    hero: {
      eyebrow: 'Console Docs',
      title: 'คู่มือ mem9 Console',
      intro:
        'mem9 Console คือศูนย์ควบคุมแบบ hosted สำหรับ project, memory space, API key, memory review, Space Chain, usage, billing และ settings',
      summaryTitle: 'เนื้อหาในคู่มือนี้',
      summaryBullets: [
        'ความสัมพันธ์ของ organization, project และ space',
        'การ install mem9 และ claim API key เดิม',
        'การดู สร้าง แก้ไข filter และลบ memory',
        'การใช้ Space Chain, usage, billing และ settings',
      ],
      tocTitle: 'On this page',
    },
    search: {
      label: 'ค้นหาเอกสาร',
      placeholder: 'ค้นหาในเมนูหรือเนื้อหา',
      empty: 'ไม่พบเอกสารที่ตรงกัน',
    },
    backToTopLabel: 'กลับขึ้นด้านบน',
    tocGroups: [
      { title: 'Start Here', sectionIDs: ['quick-start', 'account-model', 'install-and-claim'] },
      { title: 'Memory Workflows', sectionIDs: ['spaces', 'space-detail', 'memories'] },
      { title: 'Advanced Workflows', sectionIDs: ['space-chains', 'webhooks', 'usage-billing-settings', 'safe-operations'] },
    ],
    sections: [
      { id: 'quick-start', label: '01', title: 'Quick Start', bullets: ['เปิด mem9 Console จากเมนู Log in แล้วเข้าสู่ระบบ', 'ตรวจ organization และ project ก่อนแก้ resource', 'ใช้ Install mem9 เพื่อคัดลอก OpenClaw onboarding prompt', 'ใช้ Claim API key เพื่อผูก key เดิมเข้ากับ Space', 'เปิด Space หรือ Memories เพื่อดู memory ที่ agent บันทึก'] },
      { id: 'account-model', label: '02', title: 'Organization, Project, Space', subsections: [{ title: 'Organization', paragraphs: ['Organization เป็นขอบเขตของ billing, usage, settings และ permission'] }, { title: 'Project', paragraphs: ['Project เป็น container สำหรับ Space และ Space Chain'] }, { title: 'Space', paragraphs: ['Space ถือ mem9 tenant API key และ agent ใช้ key นี้เพื่อ write / recall memory'] }] },
      { id: 'install-and-claim', label: '03', title: 'Install and Claim', subsections: [{ title: 'Install mem9', bullets: ['เปิด Install mem9', 'วาง onboarding prompt ใน OpenClaw', 'ทำตาม SKILL.md เพื่อ provision หรือ reconnect key'] }, { title: 'Claim API key', bullets: ['ใช้เมื่อมี key อยู่แล้ว', 'เลือก organization, project และ Space', 'สร้าง Space ใหม่หรือผูกกับ Space ที่ยังไม่มี active key'] }] },
      { id: 'spaces', label: '04', title: 'Spaces', bullets: ['สร้าง Space สำหรับ product, environment, agent group หรือขอบเขต isolation', 'ดู name, description และ API key status ในตาราง', 'คลิกชื่อ Space เพื่อเปิด detail', 'ใช้ row actions เพื่อ edit, configure key หรือ delete'] },
      { id: 'space-detail', label: '05', title: 'Space Detail', subsections: [{ title: 'Tenant key', bullets: ['ตั้ง key ก่อนดู memory data', 'Reveal / copy key เฉพาะเมื่อจำเป็น', 'Console แสดง masked key เป็นค่าเริ่มต้น'] }, { title: 'Metrics and imports', bullets: ['ตรวจ total, pinned และ insight memories', 'ดูสถานะ latest import', 'ใช้ Space switcher เพื่อเปลี่ยน Space'] }, { title: 'Memory workbench', bullets: ['สร้าง แก้ไข และลบ memory', 'Smart ingest ดึง durable facts จากข้อความ', 'ใช้ appId เพื่อแยกการใช้งานใน key เดียวกัน'] }] },
      { id: 'memories', label: '06', title: 'Memories', bullets: ['เลือก Space เพื่อดู memory', 'Filter ด้วย text, type, state, agent, tags หรือ appId', 'เปิด detail เพื่อดู content, metadata, tags, score, confidence, session, agent, version และ timestamps', 'ถ้า Space ไม่มี key ให้ตั้งค่า key ก่อน'] },
      { id: 'space-chains', label: '07', title: 'Space Chains', subsections: [{ title: 'Create or import', bullets: ['สร้าง chain ใหม่หรือ import chain key เดิม', 'หน้า detail ใช้จัดการ key, nodes และ memory tools'] }, { title: 'Nodes and routing', bullets: ['เพิ่ม Space ที่มี active key', 'node order คือ recall order', 'routing policy prompt จำกัดว่า node ควรถูกค้นหาเมื่อใด'] }, { title: 'Chain keys', bullets: ['Create หรือ bind chain key', 'Disable key ที่ไม่ใช้แล้ว', 'ใช้ recall tools เปรียบเทียบ chain กับ Space เดี่ยว'] }] },
      { id: 'webhooks', label: '08', title: 'Webhooks', subsections: [{ title: 'Project view', bullets: ['เปิด Webhooks จาก Activity sidebar', 'ใช้ filter All, Space หรือ Space Chain', 'ตารางแสดง endpoint, scope, URL host, enabled, events และ last delivery'] }, { title: 'Create and edit', bullets: ['เลือก Space หรือ Space Chain, resource, URL, events และ enabled state', 'production endpoint ต้องใช้ HTTPS', 'signing secret แสดงเพียงครั้งเดียวหลัง create หรือ rotate-secret'] }, { title: 'Actions and deliveries', bullets: ['row menu ใช้ edit, test, deliveries, rotate secret, enable / disable และ delete', 'deliveries drawer แสดง status, attempts, HTTP status, last error และ retry time'] }] },
      { id: 'usage-billing-settings', label: '09', title: 'Usage, Billing, Settings', subsections: [{ title: 'Usage', bullets: ['ดู recall / write request usage', 'ดู date range, daily trend และ usage events'] }, { title: 'Billing', bullets: ['ดู current plan, period, included access และ on-demand settings'] }, { title: 'Settings', bullets: ['สำหรับ account, organization, theme, language และ logout'] }] },
      { id: 'safe-operations', label: '10', title: 'Safe Operations', bullets: ['Reveal API key เฉพาะ trusted client', 'อ่าน preview และ confirmation ก่อน delete', 'แยกข้อมูลที่ไม่ควรรวมกันไว้คนละ Space', 'ถ้าผลลัพธ์ผิดปกติ ให้ตรวจ org, project, Space, key และ appId filter'] },
    ],
  },
};
