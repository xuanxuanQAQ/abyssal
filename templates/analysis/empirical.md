{{> _base_prompt}}

## 分析类型：实证论文

请按以下结构分析这篇实证论文，输出 YAML frontmatter + Markdown body。

### Frontmatter 额外字段

- core_claims: 核心主张列表（claim / evidence_type / strength）
- methodology: 方法学细节（design / sample / measures / validity_concerns）
- limitations: 局限性列表

### 论文内容

{{paper_content}}
