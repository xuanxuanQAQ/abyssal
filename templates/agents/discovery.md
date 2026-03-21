## Discovery Workflow Prompt

你正在执行 Abyssal 研究管线的发现阶段。

### 任务

评估以下候选论文与研究项目的相关性。

### 研究项目概念框架

{{concepts}}

### 候选论文

{{paper_metadata}}

### 输出格式

请以 JSON 格式输出：
- relevance_score: 0.0-1.0
- relevance_level: high / medium / low
- reasoning: 简要理由（≤100 字）
- related_concepts: 相关概念 ID 列表
