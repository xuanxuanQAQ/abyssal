{{> _base_prompt}}

## 分析类型：理论论文

请按以下结构分析这篇理论论文，输出 YAML frontmatter + Markdown body。

### Frontmatter 额外字段

- core_argument: 核心论证（thesis / premises / conclusion）
- key_concepts: 关键概念列表（term / definition / novelty）
- known_criticisms: 已知批评（critic / criticism / severity）
- internal_tensions: 内部张力列表

### 论文内容

{{paper_content}}
