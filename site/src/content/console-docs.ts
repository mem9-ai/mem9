import type { DocsLocale, DocsPageCopy, DocsSection } from './docs';

const pricingDocsSections: Record<DocsLocale, DocsSection> = {
  en: {
    id: 'pricing',
    label: '10',
    title: 'Pricing',
    intro:
      'mem9 pricing is based on monthly Add Request and Retrieval Request quotas. Free has fixed included usage, while paid plans can extend with on-demand usage when billing controls are configured.',
    paragraphs: [
      'Public pricing intentionally exposes two usage meters: Add Requests and Retrieval Requests. Core Console workflows stay consistent across plans; the main tier differences are included quota, support level, on-demand behavior, and enterprise contract options.',
    ],
    tables: [
      {
        caption: 'Plans and included usage',
        columns: ['Plan', 'Monthly price', 'Add requests', 'Retrieval requests', 'End users', 'Support', 'On-demand'],
        rows: [
          ['Free', '$0', '13,000 / month', '1,300 / month', 'Unlimited', 'Community', 'Not available; fixed monthly quota'],
          ['Starter', '$9 / month', '65,000 / month', '6,500 / month', 'Unlimited', 'Email', 'Available with payment method and spend cap'],
          ['Pro', '$120 / month', '650,000 / month', '65,000 / month', 'Unlimited', 'Priority', 'Available with payment method and spend cap'],
          ['Enterprise', 'Custom', 'Unlimited or custom contract terms', 'Unlimited or custom contract terms', 'Unlimited', 'Dedicated support and custom SLA', 'Custom commercial terms'],
        ],
      },
      {
        caption: 'Capability and billing differences by tier',
        columns: ['Capability', 'Free', 'Starter', 'Pro', 'Enterprise'],
        rows: [
          ['Core Console workflows', 'Spaces, memory review, Space Chains, usage, billing, and settings', 'Spaces, memory review, Space Chains, usage, billing, and settings', 'Spaces, memory review, Space Chains, usage, billing, and settings', 'Core workflows plus custom enterprise support'],
          ['Monthly quotas', 'Fixed included usage only', 'Higher included quota for small teams and early products', 'Higher included quota for production or heavier agent usage', 'Unlimited or negotiated quota'],
          ['On-demand usage', 'No on-demand billing; upgrade or wait for the next billing cycle after limits are reached', '$0.20 / 1,000 Add Requests and $2.00 / 1,000 Retrieval Requests', '$0.20 / 1,000 Add Requests and $2.00 / 1,000 Retrieval Requests', 'Custom terms'],
          ['Spend cap', 'Not applicable', 'Required before auto top-up can run', 'Required before auto top-up can run', 'Contracted limits or account terms'],
          ['Support', 'Community', 'Email', 'Priority', 'Dedicated support and custom SLA'],
          ['Enterprise options', 'Not included', 'Not included', 'Not included', 'Security review, dedicated support, custom SLA, BYOK, dedicated retention, or large-scale storage terms can be handled by contract'],
        ],
      },
    ],
    subsections: [
      {
        title: 'Request definitions',
        paragraphs: [
          'An Add Request is one memory write or memory distillation operation. It can process messages, text, events, or structured facts into durable memory.',
          'A Retrieval Request is one memory query or recall operation scoped by user, agent, app, Space, metadata filter, or query text.',
        ],
        bullets: [
          'An Add Request can include fact extraction, memory creation, memory update, deduplication, reconciliation, embedding, and storage write.',
          'A Retrieval Request can include semantic search, keyword search, hybrid search, metadata filtering, ranking, and result assembly.',
          'For Space Chains, one recall counts as one Retrieval Request even if the chain scans multiple Spaces.',
          'Very large payloads, long conversation imports, very large top_k, unusually broad multi-Space recall, or abnormal high-frequency usage may be handled by fair-use policy or Enterprise pricing.',
        ],
      },
      {
        title: 'On-demand usage, auto top-up, and spend caps',
        paragraphs: [
          'Free does not support on-demand overage billing. When a Free account reaches its included quota, it must upgrade or wait for the next billing cycle.',
          'Starter and Pro users can enable auto top-up after adding a valid payment method. Users should configure a monthly spend cap before relying on on-demand usage. Once the hard cap is reached, overage API calls are paused until the next billing cycle or until the cap is increased.',
        ],
        tables: [
          {
            caption: 'On-demand rates for paid self-serve plans',
            columns: ['Usage meter', 'Rate', 'Applies to'],
            rows: [
              ['Add Request', '$0.20 / 1,000 requests', 'Starter and Pro'],
              ['Retrieval Request', '$2.00 / 1,000 requests', 'Starter and Pro'],
            ],
          },
        ],
      },
      {
        title: 'Coupon codes',
        paragraphs: [
          'To use a coupon code, click Upgrade Plan from Console Billing or Subscribe from the pricing page, choose a plan, and review the Payment summary. Enter the code in the Coupon code field before completing payment.',
          'A coupon code can be used only once per account. Startups can email a short summary of their company, product, stage, expected mem9 usage, and requested support to <a href="mailto:mem9@pingcap.com">mem9@pingcap.com</a> to apply for a coupon code.',
        ],
      },
      {
        title: 'Billing rules FAQ',
        tables: [
          {
            caption: 'Common billing rules',
            columns: ['Question', 'Answer'],
            rows: [
              ['Do monthly quotas roll over?', 'No. Included monthly quotas reset every billing cycle and do not roll over.'],
              ['Do failed requests count?', 'Client-side validation errors and platform errors are not billed. Successfully processed requests may be billed even if no new memory is created.'],
              ['Do duplicate or no-op Add Requests count?', 'Yes, if extraction, deduplication, or reconciliation has already been executed.'],
              ['Is storage billed separately?', 'Storage is included under normal usage. Large-scale storage or dedicated retention requirements may be handled through Enterprise pricing.'],
              ['Can customers bring their own LLM key?', 'BYOK can be supported for Enterprise customers. In that case, LLM cost may be excluded from mem9 usage pricing or handled as pass-through cost.'],
            ],
          },
        ],
      },
    ],
  },
  zh: {
    id: 'pricing',
    label: '10',
    title: '定价',
    intro:
      'mem9 定价基于每月 Add Request 和 Retrieval Request 额度。Free 使用固定包含额度；付费套餐在配置计费控制后可通过 on-demand 用量扩展。',
    paragraphs: [
      '公开定价只展示 Add Requests 和 Retrieval Requests 两类用量指标，方便理解。各套餐的 Console 核心工作流保持一致，主要差异在包含额度、支持等级、on-demand 行为和企业合同选项。',
    ],
    tables: [
      {
        caption: '套餐和包含额度',
        columns: ['套餐', '月费', 'Add requests', 'Retrieval requests', '终端用户', '支持', 'On-demand'],
        rows: [
          ['Free', '$0', '13,000 / 月', '1,300 / 月', '不限', '社区', '不支持；使用固定月度额度'],
          ['Starter', '$9 / 月', '65,000 / 月', '6,500 / 月', '不限', '邮件', '添加付款方式并设置 spend cap 后可用'],
          ['Pro', '$120 / 月', '650,000 / 月', '65,000 / 月', '不限', '优先', '添加付款方式并设置 spend cap 后可用'],
          ['Enterprise', '自定义', '不限或按合同约定', '不限或按合同约定', '不限', '专属支持和自定义 SLA', '自定义商务条款'],
        ],
      },
      {
        caption: '各套餐的能力和计费差异',
        columns: ['能力', 'Free', 'Starter', 'Pro', 'Enterprise'],
        rows: [
          ['Console 核心工作流', 'Spaces、memory review、Space Chains、usage、billing 和 settings', 'Spaces、memory review、Space Chains、usage、billing 和 settings', 'Spaces、memory review、Space Chains、usage、billing 和 settings', '核心工作流加企业级自定义支持'],
          ['月度额度', '仅固定包含额度', '适合小团队和早期产品的更高包含额度', '适合生产或更高 agent 用量的包含额度', '不限或协商额度'],
          ['On-demand 用量', '不支持超额计费；达到限额后需升级或等待下个 billing cycle', '$0.20 / 1,000 Add Requests 和 $2.00 / 1,000 Retrieval Requests', '$0.20 / 1,000 Add Requests 和 $2.00 / 1,000 Retrieval Requests', '自定义条款'],
          ['Spend cap', '不适用', 'auto top-up 生效前必须设置', 'auto top-up 生效前必须设置', '按合同限制或账号条款约定'],
          ['支持', '社区', '邮件', '优先', '专属支持和自定义 SLA'],
          ['企业选项', '不包含', '不包含', '不包含', '安全审查、专属支持、自定义 SLA、BYOK、专用 retention 或大规模存储条款可通过合同处理'],
        ],
      },
    ],
    subsections: [
      {
        title: '请求定义',
        paragraphs: [
          'Add Request 指一次 memory 写入或记忆沉淀操作，可将 messages、text、events 或 structured facts 处理成可长期保存的 memory。',
          'Retrieval Request 指一次 memory 查询或召回操作，可按 user、agent、app、Space、metadata filter 或 query text 限定范围。',
        ],
        bullets: [
          'Add Request 可包含 fact extraction、memory creation、memory update、deduplication、reconciliation、embedding 和 storage write。',
          'Retrieval Request 可包含 semantic search、keyword search、hybrid search、metadata filtering、ranking 和 result assembly。',
          '对于 Space Chains，一次 recall 即使扫描多个 Space，也只计为一次 Retrieval Request。',
          '超大 payload、长对话导入、很大的 top_k、异常宽泛的多 Space 召回或异常高频用量，可能按 fair-use policy 或 Enterprise pricing 处理。',
        ],
      },
      {
        title: 'On-demand 用量、auto top-up 和 spend cap',
        paragraphs: [
          'Free 不支持 on-demand 超额计费。Free 账号达到包含额度后，需要升级套餐或等待下一个 billing cycle。',
          'Starter 和 Pro 用户添加有效付款方式后可以启用 auto top-up。依赖 on-demand 用量前应配置月度 spend cap。达到 hard cap 后，超额 API 调用会暂停，直到下一个 billing cycle 或 cap 被提高。',
        ],
        tables: [
          {
            caption: '付费自助套餐的 on-demand 价格',
            columns: ['用量指标', '价格', '适用套餐'],
            rows: [
              ['Add Request', '$0.20 / 1,000 requests', 'Starter 和 Pro'],
              ['Retrieval Request', '$2.00 / 1,000 requests', 'Starter 和 Pro'],
            ],
          },
        ],
      },
      {
        title: 'Coupon code',
        paragraphs: [
          '使用 coupon code 时，在 Console Billing 中点击 Upgrade Plan，或从 pricing page 点击 Subscribe，选择套餐后查看 Payment summary，并在完成付款前将代码输入 Coupon code 字段。',
          '一个 coupon code 每个账号只能使用一次。初创企业可以把公司、产品、阶段、预计 mem9 用量和需要的支持简要发送到 <a href="mailto:mem9@pingcap.com">mem9@pingcap.com</a> 申请 coupon code。',
        ],
      },
      {
        title: '计费规则 FAQ',
        tables: [
          {
            caption: '常见计费规则',
            columns: ['问题', '回答'],
            rows: [
              ['月度额度会滚存吗？', '不会。包含的月度额度会在每个 billing cycle 重置，不会滚存。'],
              ['失败请求会计费吗？', '客户端参数校验错误和平台错误不计费。已成功处理的请求即使没有新增 memory，也可能计入用量。'],
              ['重复或 no-op Add Request 会计费吗？', '会，如果 extraction、deduplication 或 reconciliation 已经执行。'],
              ['Storage 会单独计费吗？', '普通用量下 storage 包含在套餐内。大规模存储或专用 retention 需求可通过 Enterprise pricing 处理。'],
              ['客户可以使用自己的 LLM key 吗？', 'Enterprise 客户可支持 BYOK。此时 LLM 成本可从 mem9 usage pricing 中剥离，或作为 pass-through cost 处理。'],
            ],
          },
        ],
      },
    ],
  },
  ja: {
    id: 'pricing',
    label: '10',
    title: '料金',
    intro:
      'mem9 の料金は、月ごとの Add Request と Retrieval Request の割り当てに基づきます。Free は固定枠で、 paid plan は billing control を設定すると on-demand usage を利用できます。',
    paragraphs: [
      '公開料金では Add Requests と Retrieval Requests の 2 つの usage meter だけを表示します。Console の基本ワークフローは各 plan で共通で、主な違いは含まれる quota、support、on-demand、Enterprise 契約オプションです。',
    ],
    tables: [
      {
        caption: 'Plans and included usage',
        columns: ['Plan', '月額', 'Add requests', 'Retrieval requests', 'End users', 'Support', 'On-demand'],
        rows: [
          ['Free', '$0', '13,000 / 月', '1,300 / 月', '無制限', 'Community', '利用不可。月ごとの固定 quota'],
          ['Starter', '$9 / 月', '65,000 / 月', '6,500 / 月', '無制限', 'Email', 'payment method と spend cap の設定後に利用可能'],
          ['Pro', '$120 / 月', '650,000 / 月', '65,000 / 月', '無制限', 'Priority', 'payment method と spend cap の設定後に利用可能'],
          ['Enterprise', 'Custom', '無制限または契約条件による', '無制限または契約条件による', '無制限', 'Dedicated support and custom SLA', 'Custom commercial terms'],
        ],
      },
      {
        caption: 'Tier ごとの機能と billing の違い',
        columns: ['Capability', 'Free', 'Starter', 'Pro', 'Enterprise'],
        rows: [
          ['Core Console workflows', 'Spaces、memory review、Space Chains、usage、billing、settings', 'Spaces、memory review、Space Chains、usage、billing、settings', 'Spaces、memory review、Space Chains、usage、billing、settings', '基本 workflow に加えて enterprise support'],
          ['Monthly quotas', '固定の included usage のみ', '小規模チームや初期 product 向けの quota', 'production や重めの agent usage 向けの quota', '無制限または交渉 quota'],
          ['On-demand usage', 'overage billing なし。上限到達後は upgrade または次の billing cycle を待つ', '$0.20 / 1,000 Add Requests と $2.00 / 1,000 Retrieval Requests', '$0.20 / 1,000 Add Requests と $2.00 / 1,000 Retrieval Requests', 'Custom terms'],
          ['Spend cap', '対象外', 'auto top-up 前に必須', 'auto top-up 前に必須', '契約上の limit または account terms'],
          ['Support', 'Community', 'Email', 'Priority', 'Dedicated support and custom SLA'],
          ['Enterprise options', 'なし', 'なし', 'なし', 'Security review、dedicated support、custom SLA、BYOK、dedicated retention、大規模 storage は契約で対応可能'],
        ],
      },
    ],
    subsections: [
      {
        title: 'Request definitions',
        paragraphs: [
          'Add Request は memory write または memory distillation の 1 回分です。messages、text、events、structured facts を durable memory に処理します。',
          'Retrieval Request は user、agent、app、Space、metadata filter、query text で scoped された memory query または recall の 1 回分です。',
        ],
        bullets: [
          'Add Request には fact extraction、memory creation、memory update、deduplication、reconciliation、embedding、storage write が含まれます。',
          'Retrieval Request には semantic search、keyword search、hybrid search、metadata filtering、ranking、result assembly が含まれます。',
          'Space Chains では、複数の Space を scan しても 1 recall は 1 Retrieval Request です。',
          '非常に大きい payload、長い conversation import、大きい top_k、広すぎる multi-Space recall、異常に高頻度な usage は fair-use policy または Enterprise pricing で扱われる場合があります。',
        ],
      },
      {
        title: 'On-demand usage, auto top-up, and spend caps',
        paragraphs: [
          'Free は on-demand overage billing をサポートしません。included quota に達した場合は upgrade するか次の billing cycle を待ちます。',
          'Starter と Pro は有効な payment method を追加した後に auto top-up を有効化できます。on-demand usage に依存する前に monthly spend cap を設定してください。hard cap に達すると、次の billing cycle または cap 引き上げまで overage API calls は停止します。',
        ],
        tables: [
          {
            caption: 'Paid self-serve plans の on-demand rates',
            columns: ['Usage meter', 'Rate', 'Applies to'],
            rows: [
              ['Add Request', '$0.20 / 1,000 requests', 'Starter and Pro'],
              ['Retrieval Request', '$2.00 / 1,000 requests', 'Starter and Pro'],
            ],
          },
        ],
      },
      {
        title: 'Coupon codes',
        paragraphs: [
          'Coupon code を使うには、Console Billing の Upgrade Plan または pricing page の Subscribe をクリックし、plan を選んで Payment summary を確認します。支払い完了前に Coupon code field に code を入力してください。',
          'Coupon code は 1 account につき 1 回だけ利用できます。Startup は会社、product、stage、想定 mem9 usage、必要な support の短い summary を <a href="mailto:mem9@pingcap.com">mem9@pingcap.com</a> に送ることで coupon code を申請できます。',
        ],
      },
      {
        title: 'Billing rules FAQ',
        tables: [
          {
            caption: 'Common billing rules',
            columns: ['Question', 'Answer'],
            rows: [
              ['Monthly quotas は繰り越されますか？', 'いいえ。included monthly quotas は各 billing cycle で reset され、繰り越されません。'],
              ['Failed requests は count されますか？', 'client-side validation errors と platform errors は billed されません。正常に処理された request は新しい memory が作成されなくても billed される場合があります。'],
              ['Duplicate または no-op Add Requests は count されますか？', 'はい。extraction、deduplication、reconciliation が既に実行された場合は count されます。'],
              ['Storage は別料金ですか？', '通常利用では storage は含まれます。大規模 storage や dedicated retention requirements は Enterprise pricing で扱えます。'],
              ['Customer は own LLM key を持ち込めますか？', 'Enterprise customers では BYOK をサポートできます。その場合、LLM cost は mem9 usage pricing から除外するか pass-through cost として扱えます。'],
            ],
          },
        ],
      },
    ],
  },
  ko: {
    id: 'pricing',
    label: '10',
    title: '요금',
    intro:
      'mem9 요금은 월별 Add Request 와 Retrieval Request quota 를 기준으로 합니다. Free 는 고정 included usage 를 사용하며, 유료 plan 은 billing control 설정 후 on-demand usage 로 확장할 수 있습니다.',
    paragraphs: [
      '공개 가격은 Add Requests 와 Retrieval Requests 두 usage meter 만 보여줍니다. Core Console workflow 는 plan 간 동일하며, 주요 차이는 included quota, support level, on-demand 동작, enterprise 계약 옵션입니다.',
    ],
    tables: [
      {
        caption: 'Plans and included usage',
        columns: ['Plan', '월 가격', 'Add requests', 'Retrieval requests', 'End users', 'Support', 'On-demand'],
        rows: [
          ['Free', '$0', '13,000 / 월', '1,300 / 월', '무제한', 'Community', '사용 불가. 고정 월 quota'],
          ['Starter', '$9 / 월', '65,000 / 월', '6,500 / 월', '무제한', 'Email', 'payment method 와 spend cap 설정 후 사용 가능'],
          ['Pro', '$120 / 월', '650,000 / 월', '65,000 / 월', '무제한', 'Priority', 'payment method 와 spend cap 설정 후 사용 가능'],
          ['Enterprise', 'Custom', '무제한 또는 계약 조건', '무제한 또는 계약 조건', '무제한', 'Dedicated support and custom SLA', 'Custom commercial terms'],
        ],
      },
      {
        caption: 'Tier 별 기능 및 billing 차이',
        columns: ['Capability', 'Free', 'Starter', 'Pro', 'Enterprise'],
        rows: [
          ['Core Console workflows', 'Spaces, memory review, Space Chains, usage, billing, settings', 'Spaces, memory review, Space Chains, usage, billing, settings', 'Spaces, memory review, Space Chains, usage, billing, settings', 'Core workflow 와 custom enterprise support'],
          ['Monthly quotas', '고정 included usage 만 제공', '소규모 팀과 초기 product 용 quota', 'production 또는 더 많은 agent usage 용 quota', '무제한 또는 협의 quota'],
          ['On-demand usage', 'overage billing 없음. limit 도달 후 upgrade 하거나 다음 billing cycle 을 기다림', '$0.20 / 1,000 Add Requests 및 $2.00 / 1,000 Retrieval Requests', '$0.20 / 1,000 Add Requests 및 $2.00 / 1,000 Retrieval Requests', 'Custom terms'],
          ['Spend cap', '해당 없음', 'auto top-up 전에 필수', 'auto top-up 전에 필수', '계약 limit 또는 account terms'],
          ['Support', 'Community', 'Email', 'Priority', 'Dedicated support and custom SLA'],
          ['Enterprise options', '미포함', '미포함', '미포함', 'Security review, dedicated support, custom SLA, BYOK, dedicated retention, 대규모 storage 조건은 계약으로 처리 가능'],
        ],
      },
    ],
    subsections: [
      {
        title: 'Request definitions',
        paragraphs: [
          'Add Request 는 memory write 또는 memory distillation 작업 1회입니다. messages, text, events, structured facts 를 durable memory 로 처리합니다.',
          'Retrieval Request 는 user, agent, app, Space, metadata filter, query text 로 scope 된 memory query 또는 recall 1회입니다.',
        ],
        bullets: [
          'Add Request 에는 fact extraction, memory creation, memory update, deduplication, reconciliation, embedding, storage write 가 포함될 수 있습니다.',
          'Retrieval Request 에는 semantic search, keyword search, hybrid search, metadata filtering, ranking, result assembly 가 포함될 수 있습니다.',
          'Space Chains 에서는 여러 Space 를 scan 하더라도 recall 1회는 Retrieval Request 1회로 계산됩니다.',
          '매우 큰 payload, 긴 conversation import, 큰 top_k, 과도하게 넓은 multi-Space recall, 비정상적인 고빈도 usage 는 fair-use policy 또는 Enterprise pricing 으로 처리될 수 있습니다.',
        ],
      },
      {
        title: 'On-demand usage, auto top-up, and spend caps',
        paragraphs: [
          'Free 는 on-demand overage billing 을 지원하지 않습니다. included quota 에 도달하면 upgrade 하거나 다음 billing cycle 을 기다려야 합니다.',
          'Starter 와 Pro 사용자는 유효한 payment method 를 추가한 뒤 auto top-up 을 켤 수 있습니다. on-demand usage 에 의존하기 전에 monthly spend cap 을 설정해야 합니다. hard cap 에 도달하면 다음 billing cycle 또는 cap 증가 전까지 overage API calls 가 일시 중지됩니다.',
        ],
        tables: [
          {
            caption: 'Paid self-serve plans 의 on-demand rates',
            columns: ['Usage meter', 'Rate', 'Applies to'],
            rows: [
              ['Add Request', '$0.20 / 1,000 requests', 'Starter and Pro'],
              ['Retrieval Request', '$2.00 / 1,000 requests', 'Starter and Pro'],
            ],
          },
        ],
      },
      {
        title: 'Coupon codes',
        paragraphs: [
          'Coupon code 를 사용하려면 Console Billing 의 Upgrade Plan 또는 pricing page 의 Subscribe 를 클릭하고, plan 을 선택한 뒤 Payment summary 를 확인합니다. 결제 완료 전에 Coupon code field 에 code 를 입력하세요.',
          'Coupon code 는 account 당 한 번만 사용할 수 있습니다. Startup 은 회사, product, stage, 예상 mem9 usage, 필요한 support 요약을 <a href="mailto:mem9@pingcap.com">mem9@pingcap.com</a> 으로 보내 coupon code 를 신청할 수 있습니다.',
        ],
      },
      {
        title: 'Billing rules FAQ',
        tables: [
          {
            caption: 'Common billing rules',
            columns: ['Question', 'Answer'],
            rows: [
              ['Monthly quotas 는 이월되나요?', '아니요. included monthly quotas 는 billing cycle 마다 reset 되며 이월되지 않습니다.'],
              ['Failed requests 도 count 되나요?', 'client-side validation errors 와 platform errors 는 billed 되지 않습니다. 정상 처리된 request 는 새 memory 가 만들어지지 않아도 billed 될 수 있습니다.'],
              ['Duplicate 또는 no-op Add Requests 는 count 되나요?', '예. extraction, deduplication, reconciliation 이 이미 실행된 경우 count 됩니다.'],
              ['Storage 는 별도 과금인가요?', '일반 usage 에서는 storage 가 포함됩니다. 대규모 storage 또는 dedicated retention requirements 는 Enterprise pricing 으로 처리할 수 있습니다.'],
              ['Customer 가 own LLM key 를 가져올 수 있나요?', 'Enterprise customers 는 BYOK 를 지원할 수 있습니다. 이 경우 LLM cost 는 mem9 usage pricing 에서 제외하거나 pass-through cost 로 처리할 수 있습니다.'],
            ],
          },
        ],
      },
    ],
  },
  id: {
    id: 'pricing',
    label: '10',
    title: 'Harga',
    intro:
      'Harga mem9 didasarkan pada kuota bulanan Add Request dan Retrieval Request. Free memakai included usage tetap, sedangkan plan berbayar dapat diperluas dengan on-demand usage setelah billing control dikonfigurasi.',
    paragraphs: [
      'Harga publik hanya menampilkan dua usage meter: Add Requests dan Retrieval Requests. Core Console workflows tetap sama di semua plan; perbedaannya ada pada included quota, level support, perilaku on-demand, dan opsi kontrak Enterprise.',
    ],
    tables: [
      {
        caption: 'Plans and included usage',
        columns: ['Plan', 'Harga bulanan', 'Add requests', 'Retrieval requests', 'End users', 'Support', 'On-demand'],
        rows: [
          ['Free', '$0', '13,000 / bulan', '1,300 / bulan', 'Unlimited', 'Community', 'Tidak tersedia; fixed monthly quota'],
          ['Starter', '$9 / bulan', '65,000 / bulan', '6,500 / bulan', 'Unlimited', 'Email', 'Tersedia dengan payment method dan spend cap'],
          ['Pro', '$120 / bulan', '650,000 / bulan', '65,000 / bulan', 'Unlimited', 'Priority', 'Tersedia dengan payment method dan spend cap'],
          ['Enterprise', 'Custom', 'Unlimited atau sesuai kontrak', 'Unlimited atau sesuai kontrak', 'Unlimited', 'Dedicated support and custom SLA', 'Custom commercial terms'],
        ],
      },
      {
        caption: 'Perbedaan capability dan billing per tier',
        columns: ['Capability', 'Free', 'Starter', 'Pro', 'Enterprise'],
        rows: [
          ['Core Console workflows', 'Spaces, memory review, Space Chains, usage, billing, dan settings', 'Spaces, memory review, Space Chains, usage, billing, dan settings', 'Spaces, memory review, Space Chains, usage, billing, dan settings', 'Core workflows plus custom enterprise support'],
          ['Monthly quotas', 'Hanya fixed included usage', 'Quota lebih besar untuk tim kecil dan produk awal', 'Quota lebih besar untuk production atau agent usage yang lebih berat', 'Unlimited atau negotiated quota'],
          ['On-demand usage', 'Tidak ada overage billing; upgrade atau tunggu billing cycle berikutnya setelah limit tercapai', '$0.20 / 1,000 Add Requests dan $2.00 / 1,000 Retrieval Requests', '$0.20 / 1,000 Add Requests dan $2.00 / 1,000 Retrieval Requests', 'Custom terms'],
          ['Spend cap', 'Tidak berlaku', 'Wajib sebelum auto top-up berjalan', 'Wajib sebelum auto top-up berjalan', 'Contracted limits atau account terms'],
          ['Support', 'Community', 'Email', 'Priority', 'Dedicated support and custom SLA'],
          ['Enterprise options', 'Tidak termasuk', 'Tidak termasuk', 'Tidak termasuk', 'Security review, dedicated support, custom SLA, BYOK, dedicated retention, atau large-scale storage terms dapat ditangani melalui kontrak'],
        ],
      },
    ],
    subsections: [
      {
        title: 'Request definitions',
        paragraphs: [
          'Add Request adalah satu operasi memory write atau memory distillation. Operasi ini memproses messages, text, events, atau structured facts menjadi durable memory.',
          'Retrieval Request adalah satu operasi memory query atau recall yang di-scope oleh user, agent, app, Space, metadata filter, atau query text.',
        ],
        bullets: [
          'Add Request dapat mencakup fact extraction, memory creation, memory update, deduplication, reconciliation, embedding, dan storage write.',
          'Retrieval Request dapat mencakup semantic search, keyword search, hybrid search, metadata filtering, ranking, dan result assembly.',
          'Untuk Space Chains, satu recall dihitung sebagai satu Retrieval Request meskipun chain memindai beberapa Spaces.',
          'Payload sangat besar, long conversation imports, top_k sangat besar, multi-Space recall yang terlalu luas, atau usage abnormal berfrekuensi tinggi dapat ditangani melalui fair-use policy atau Enterprise pricing.',
        ],
      },
      {
        title: 'On-demand usage, auto top-up, and spend caps',
        paragraphs: [
          'Free tidak mendukung on-demand overage billing. Saat akun Free mencapai included quota, pengguna harus upgrade atau menunggu billing cycle berikutnya.',
          'Pengguna Starter dan Pro dapat mengaktifkan auto top-up setelah menambahkan payment method valid. Konfigurasikan monthly spend cap sebelum bergantung pada on-demand usage. Setelah hard cap tercapai, overage API calls akan dijeda sampai billing cycle berikutnya atau cap dinaikkan.',
        ],
        tables: [
          {
            caption: 'On-demand rates untuk paid self-serve plans',
            columns: ['Usage meter', 'Rate', 'Applies to'],
            rows: [
              ['Add Request', '$0.20 / 1,000 requests', 'Starter and Pro'],
              ['Retrieval Request', '$2.00 / 1,000 requests', 'Starter and Pro'],
            ],
          },
        ],
      },
      {
        title: 'Coupon codes',
        paragraphs: [
          'Untuk memakai coupon code, klik Upgrade Plan dari Console Billing atau Subscribe dari pricing page, pilih plan, lalu tinjau Payment summary. Masukkan code di field Coupon code sebelum menyelesaikan pembayaran.',
          'Coupon code hanya dapat digunakan satu kali per account. Startup dapat mengirim ringkasan singkat tentang company, product, stage, expected mem9 usage, dan requested support ke <a href="mailto:mem9@pingcap.com">mem9@pingcap.com</a> untuk mengajukan coupon code.',
        ],
      },
      {
        title: 'Billing rules FAQ',
        tables: [
          {
            caption: 'Common billing rules',
            columns: ['Question', 'Answer'],
            rows: [
              ['Apakah monthly quotas roll over?', 'Tidak. Included monthly quotas reset setiap billing cycle dan tidak roll over.'],
              ['Apakah failed requests dihitung?', 'Client-side validation errors dan platform errors tidak billed. Request yang berhasil diproses dapat billed meskipun tidak ada memory baru yang dibuat.'],
              ['Apakah duplicate atau no-op Add Requests dihitung?', 'Ya, jika extraction, deduplication, atau reconciliation sudah dijalankan.'],
              ['Apakah storage billed terpisah?', 'Storage termasuk dalam normal usage. Large-scale storage atau dedicated retention requirements dapat ditangani melalui Enterprise pricing.'],
              ['Bisakah customer membawa own LLM key?', 'BYOK dapat didukung untuk Enterprise customers. Dalam kasus itu, LLM cost dapat dikeluarkan dari mem9 usage pricing atau diperlakukan sebagai pass-through cost.'],
            ],
          },
        ],
      },
    ],
  },
  th: {
    id: 'pricing',
    label: '10',
    title: 'ราคา',
    intro:
      'ราคาของ mem9 อิงตามโควต้ารายเดือนของ Add Request และ Retrieval Request แพ็กเกจ Free มี included usage แบบคงที่ ส่วนแพ็กเกจแบบชำระเงินสามารถขยายด้วย on-demand usage ได้หลังตั้งค่า billing control',
    paragraphs: [
      'ราคาสาธารณะตั้งใจแสดง usage meter เพียงสองแบบคือ Add Requests และ Retrieval Requests โดย core Console workflows เหมือนกันในแต่ละ plan ความต่างหลักคือ included quota, support level, on-demand behavior และ Enterprise contract options',
    ],
    tables: [
      {
        caption: 'Plans and included usage',
        columns: ['Plan', 'ราคารายเดือน', 'Add requests', 'Retrieval requests', 'End users', 'Support', 'On-demand'],
        rows: [
          ['Free', '$0', '13,000 / เดือน', '1,300 / เดือน', 'ไม่จำกัด', 'Community', 'ไม่รองรับ เป็น fixed monthly quota'],
          ['Starter', '$9 / เดือน', '65,000 / เดือน', '6,500 / เดือน', 'ไม่จำกัด', 'Email', 'ใช้ได้เมื่อมี payment method และ spend cap'],
          ['Pro', '$120 / เดือน', '650,000 / เดือน', '65,000 / เดือน', 'ไม่จำกัด', 'Priority', 'ใช้ได้เมื่อมี payment method และ spend cap'],
          ['Enterprise', 'Custom', 'ไม่จำกัดหรือตามสัญญา', 'ไม่จำกัดหรือตามสัญญา', 'ไม่จำกัด', 'Dedicated support and custom SLA', 'Custom commercial terms'],
        ],
      },
      {
        caption: 'ความต่างของ capability และ billing ตาม tier',
        columns: ['Capability', 'Free', 'Starter', 'Pro', 'Enterprise'],
        rows: [
          ['Core Console workflows', 'Spaces, memory review, Space Chains, usage, billing และ settings', 'Spaces, memory review, Space Chains, usage, billing และ settings', 'Spaces, memory review, Space Chains, usage, billing และ settings', 'Core workflows พร้อม custom enterprise support'],
          ['Monthly quotas', 'มีเฉพาะ fixed included usage', 'quota ที่สูงขึ้นสำหรับทีมขนาดเล็กและ product ระยะแรก', 'quota ที่สูงขึ้นสำหรับ production หรือ agent usage ที่หนักขึ้น', 'ไม่จำกัดหรือตามที่ตกลง'],
          ['On-demand usage', 'ไม่มี overage billing เมื่อถึง limit ต้อง upgrade หรือรอ billing cycle ถัดไป', '$0.20 / 1,000 Add Requests และ $2.00 / 1,000 Retrieval Requests', '$0.20 / 1,000 Add Requests และ $2.00 / 1,000 Retrieval Requests', 'Custom terms'],
          ['Spend cap', 'ไม่เกี่ยวข้อง', 'ต้องตั้งค่าก่อน auto top-up ทำงาน', 'ต้องตั้งค่าก่อน auto top-up ทำงาน', 'ตาม contracted limits หรือ account terms'],
          ['Support', 'Community', 'Email', 'Priority', 'Dedicated support and custom SLA'],
          ['Enterprise options', 'ไม่รวม', 'ไม่รวม', 'ไม่รวม', 'Security review, dedicated support, custom SLA, BYOK, dedicated retention หรือ large-scale storage terms จัดการผ่านสัญญาได้'],
        ],
      },
    ],
    subsections: [
      {
        title: 'Request definitions',
        paragraphs: [
          'Add Request คือการทำ memory write หรือ memory distillation หนึ่งครั้ง เพื่อประมวลผล messages, text, events หรือ structured facts ให้เป็น durable memory',
          'Retrieval Request คือ memory query หรือ recall หนึ่งครั้งที่ scope ด้วย user, agent, app, Space, metadata filter หรือ query text',
        ],
        bullets: [
          'Add Request อาจรวม fact extraction, memory creation, memory update, deduplication, reconciliation, embedding และ storage write',
          'Retrieval Request อาจรวม semantic search, keyword search, hybrid search, metadata filtering, ranking และ result assembly',
          'สำหรับ Space Chains การ recall หนึ่งครั้งนับเป็นหนึ่ง Retrieval Request แม้ chain จะ scan หลาย Spaces',
          'payload ขนาดใหญ่มาก, long conversation imports, top_k สูงมาก, multi-Space recall ที่กว้างผิดปกติ หรือ usage ความถี่สูงผิดปกติ อาจจัดการด้วย fair-use policy หรือ Enterprise pricing',
        ],
      },
      {
        title: 'On-demand usage, auto top-up, and spend caps',
        paragraphs: [
          'Free ไม่รองรับ on-demand overage billing เมื่อบัญชี Free ใช้ถึง included quota ต้อง upgrade หรือรอ billing cycle ถัดไป',
          'ผู้ใช้ Starter และ Pro เปิด auto top-up ได้หลังเพิ่ม payment method ที่ถูกต้อง ควรตั้ง monthly spend cap ก่อนพึ่งพา on-demand usage เมื่อถึง hard cap แล้ว overage API calls จะถูก pause จนถึง billing cycle ถัดไปหรือจนกว่าจะเพิ่ม cap',
        ],
        tables: [
          {
            caption: 'On-demand rates สำหรับ paid self-serve plans',
            columns: ['Usage meter', 'Rate', 'Applies to'],
            rows: [
              ['Add Request', '$0.20 / 1,000 requests', 'Starter and Pro'],
              ['Retrieval Request', '$2.00 / 1,000 requests', 'Starter and Pro'],
            ],
          },
        ],
      },
      {
        title: 'Coupon codes',
        paragraphs: [
          'หากต้องการใช้ coupon code ให้คลิก Upgrade Plan จาก Console Billing หรือ Subscribe จาก pricing page เลือก plan แล้วตรวจ Payment summary จากนั้นกรอก code ในช่อง Coupon code ก่อนชำระเงินให้เสร็จ',
          'Coupon code ใช้ได้เพียงหนึ่งครั้งต่อ account เท่านั้น Startup สามารถส่ง summary สั้นๆ เกี่ยวกับ company, product, stage, expected mem9 usage และ requested support ไปที่ <a href="mailto:mem9@pingcap.com">mem9@pingcap.com</a> เพื่อขอ coupon code',
        ],
      },
      {
        title: 'Billing rules FAQ',
        tables: [
          {
            caption: 'Common billing rules',
            columns: ['Question', 'Answer'],
            rows: [
              ['Monthly quotas roll over หรือไม่?', 'ไม่ Included monthly quotas จะ reset ทุก billing cycle และไม่ roll over'],
              ['Failed requests ถูกนับหรือไม่?', 'Client-side validation errors และ platform errors ไม่ถูก billed ส่วน request ที่ประมวลผลสำเร็จอาจถูก billed แม้ไม่ได้สร้าง memory ใหม่'],
              ['Duplicate หรือ no-op Add Requests ถูกนับหรือไม่?', 'นับ หาก extraction, deduplication หรือ reconciliation ถูกเรียกใช้แล้ว'],
              ['Storage billed แยกหรือไม่?', 'Storage รวมอยู่ใน normal usage ส่วน large-scale storage หรือ dedicated retention requirements จัดการผ่าน Enterprise pricing ได้'],
              ['Customer นำ own LLM key มาใช้ได้หรือไม่?', 'Enterprise customers รองรับ BYOK ได้ ในกรณีนั้น LLM cost อาจแยกออกจาก mem9 usage pricing หรือจัดเป็น pass-through cost'],
            ],
          },
        ],
      },
    ],
  },
};

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
      { title: 'Advanced Workflows', sectionIDs: ['space-chains', 'webhooks', 'usage-billing-settings', 'pricing', 'safe-operations'] },
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
      pricingDocsSections.en,
      {
        id: 'safe-operations',
        label: '11',
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
      { title: '高级工作流', sectionIDs: ['space-chains', 'webhooks', 'usage-billing-settings', 'pricing', 'safe-operations'] },
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
      pricingDocsSections.zh,
      {
        id: 'safe-operations',
        label: '11',
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
      { title: 'Advanced Workflows', sectionIDs: ['space-chains', 'webhooks', 'usage-billing-settings', 'pricing', 'safe-operations'] },
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
      pricingDocsSections.ja,
      {
        id: 'safe-operations',
        label: '11',
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
      { title: 'Advanced Workflows', sectionIDs: ['space-chains', 'webhooks', 'usage-billing-settings', 'pricing', 'safe-operations'] },
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
      pricingDocsSections.ko,
      { id: 'safe-operations', label: '11', title: 'Safe Operations', bullets: ['API key 는 trusted client 설정 시에만 reveal 합니다.', 'delete 전에 preview 와 confirmation 을 확인합니다.', '섞이면 안 되는 data 는 별도 Space 로 나눕니다.', '결과가 이상하면 org, project, Space, key, appId filter 를 확인합니다.'] },
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
      { title: 'Advanced Workflows', sectionIDs: ['space-chains', 'webhooks', 'usage-billing-settings', 'pricing', 'safe-operations'] },
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
      pricingDocsSections.id,
      { id: 'safe-operations', label: '11', title: 'Safe Operations', bullets: ['Reveal API key hanya untuk trusted client.', 'Baca preview dan confirmation sebelum delete.', 'Pisahkan data sensitif ke Space berbeda.', 'Jika hasil aneh, cek org, project, Space, key, dan appId filter.'] },
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
      { title: 'Advanced Workflows', sectionIDs: ['space-chains', 'webhooks', 'usage-billing-settings', 'pricing', 'safe-operations'] },
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
      pricingDocsSections.th,
      { id: 'safe-operations', label: '11', title: 'Safe Operations', bullets: ['Reveal API key เฉพาะ trusted client', 'อ่าน preview และ confirmation ก่อน delete', 'แยกข้อมูลที่ไม่ควรรวมกันไว้คนละ Space', 'ถ้าผลลัพธ์ผิดปกติ ให้ตรวจ org, project, Space, key และ appId filter'] },
    ],
  },
};
