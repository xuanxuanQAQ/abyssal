{{> _base_prompt}}

## 分析类型：综述论文

请按以下结构分析这篇综述论文，输出 YAML frontmatter + Markdown body。

### Frontmatter 额外字段

- scope: 综述范围（topic / time_range / paper_count）
- taxonomy: 分类体系（category / description / representative_works）
- consensus_points: 共识观点列表
- open_debates: 开放争论（debate / positions）
- identified_gaps: 已识别空白
- bibliography_mining: 值得追踪的参考文献（title / reason）

### 论文内容

{{paper_content}}
