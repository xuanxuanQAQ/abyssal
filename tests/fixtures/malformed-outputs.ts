/**
 * Shared malformed LLM output corpus for parser / repair / robustness tests.
 *
 * Each entry has: name, input (raw LLM output), expected parse behavior.
 */

// ── Multi-fence samples ──

export const MULTI_FENCE_YAML_THEN_CODE = `Some preamble text
---
concept_mappings:
  - concept_id: affordance
    relation: supports
    confidence: 0.82
    evidence:
      en: "The paper discusses affordance in HCI"
      zh: "论文讨论了HCI中的可供性"
---
Here is some trailing analysis.

\`\`\`python
import numpy as np
result = np.mean([1,2,3])
\`\`\`
`;

export const MULTI_CODE_BLOCK_YAML_PREFERRED = `Here is the analysis:

\`\`\`typescript
const x = 42;
console.log(x);
\`\`\`

\`\`\`yaml
concept_mappings:
  - concept_id: embodied_cognition
    relation: extends
    confidence: 0.75
    evidence:
      en: "Embodied cognition framework"
      zh: "具身认知框架"
\`\`\`

Final thoughts.
`;

// ── Half-fence / unclosed ──

export const UNCLOSED_YAML_FENCE = `---
framework_state: analyzing
concept_mappings:
  - concept_id: distributed_cognition
    relation: supports
    confidence: 0.88
    evidence:
      en: "Distributed cognition theory"
      zh: "分布式认知理论"

## Summary
The paper presents a strong case for distributed cognition.
`;

export const FENCE_MISSING_CLOSING_DASHES = `---
concept_mappings:
  - concept_id: sensemaking
    relation: challenges
    confidence: 0.65
    evidence:
      en: "Sensemaking process described"
      zh: "意义构建过程描述"

Some body text follows without closing fence.
`;

// ── Wrong type evidence / malformed values ──

export const BOOLEAN_CONFIDENCE = `---
concept_mappings:
  - concept_id: affordance
    relation: supports
    confidence: yes
    evidence:
      en: "Clear support"
      zh: "明确支持"
---
`;

export const STRING_CONFIDENCE = `---
concept_mappings:
  - concept_id: affordance
    relation: supports
    confidence: high
    evidence:
      en: "Strong evidence"
      zh: "强证据"
---
`;

export const EVIDENCE_AS_PLAIN_STRING = `---
concept_mappings:
  - concept_id: affordance
    relation: supports
    confidence: 0.9
    evidence: "The paper clearly supports this concept"
---
`;

// ── Markdown noise ──

export const HEAVY_MARKDOWN_NOISE = `# Analysis Report

## Key Findings

The paper presents several important concepts.

> **Important:** The following analysis follows the structured format.

---
concept_mappings:
  - concept_id: ecological_psychology
    relation: supports
    confidence: 0.78
    evidence:
      en: "Ecological psychology: the approach is grounded"
      zh: "生态心理学：该方法是扎根的"
---

### Additional Notes

- Point 1: Further inquiry needed
- Point 2: Cross-reference with [Gibson1979]

| Concept | Relation | Confidence |
|---------|----------|------------|
| ecology | supports | 0.78       |
`;

export const INTERLEAVED_MARKDOWN_AND_YAML = `Here is my analysis of the paper:

1. **Methodology**: Sound experimental design
2. **Results**: Statistically significant

\`\`\`yaml
concept_mappings:
  - concept_id: methodology
    relation: supports
    confidence: 0.85
    evidence:
      en: "Sound experimental design with p < 0.05"
      zh: "可靠的实验设计，p < 0.05"
\`\`\`

3. **Discussion**: The authors argue that...

> This is a blockquote with *emphasis* and **bold**.
`;

// ── Smart quotes / unicode issues ──

export const SMART_QUOTES_IN_VALUES = `---
concept_mappings:
  - concept_id: affordance
    relation: supports
    confidence: 0.82
    evidence:
      en: \u201CThe paper argues that affordances are key\u201D
      zh: \u201C论文论证了可供性是关键\u201D
---
`;

// ── Trailing commas (JSON-style) ──

export const JSON_TRAILING_COMMAS = `---
concept_mappings:
  - concept_id: affordance,
    relation: supports,
    confidence: 0.9,
    evidence:
      en: "Evidence text",
      zh: "证据文本",
---
`;

// ── Unquoted colons in values ──

export const UNQUOTED_COLONS = `---
concept_mappings:
  - concept_id: affordance
    relation: supports
    confidence: 0.85
    evidence:
      en: The paper argues that: affordances are central to HCI
      zh: 论文论证了：可供性是HCI的核心
---
`;

// ── Tab indentation ──

export const TAB_INDENTED_YAML = `---
concept_mappings:
\t- concept_id: affordance
\t\trelation: supports
\t\tconfidence: 0.85
\t\tevidence:
\t\t\ten: "Evidence text"
\t\t\tzh: "证据文本"
---
`;

// ── Pure prose (total failure) ──

export const PURE_PROSE_NO_STRUCTURE = `This paper examines the role of affordances in human-computer interaction.
The authors present a comprehensive framework for understanding how users
perceive and interact with digital interfaces. Their methodology combines
qualitative interviews with quantitative eye-tracking data.

In conclusion, the paper makes a significant contribution to our understanding
of affordance theory in the context of modern interface design.`;

// ── Empty / minimal inputs ──

export const EMPTY_STRING = '';
export const WHITESPACE_ONLY = '   \n\n  \t  \n  ';
export const JUST_FENCES = '---\n---';

// ── JSON fallback ──

export const JSON_WRAPPED_OUTPUT = `\`\`\`json
{
  "concept_mappings": [
    {
      "concept_id": "affordance",
      "relation": "supports",
      "confidence": 0.9,
      "evidence": {
        "en": "The paper supports affordance theory",
        "zh": "论文支持可供性理论"
      }
    }
  ]
}
\`\`\`
`;

export const BARE_JSON_OUTPUT = `{
  "concept_mappings": [
    {
      "concept_id": "sensemaking",
      "relation": "extends",
      "confidence": 0.75,
      "evidence": {
        "en": "Extends sensemaking framework",
        "zh": "扩展了意义构建框架"
      }
    }
  ]
}`;
